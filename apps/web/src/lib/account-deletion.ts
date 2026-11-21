import "server-only";

import { del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { normalizeBlobPathname } from "@/lib/blob-signing";

/**
 * In-app account deletion (App Store Guideline 5.1.1(v)).
 *
 * A customer record belongs to the shop as much as to the person: jobs and
 * payments hang off it and the shop's books have to keep adding up. So a
 * customer's deletion anonymizes rather than deletes the row: everything that
 * identifies them or that they said goes, and the repair history stays with
 * no name on it.
 *
 * Staff deletion removes only that person's login. The shop, its data and any
 * subscription are left alone, even when it was the last login.
 */

export const DELETED_CUSTOMER_NAME = "Deleted customer";

/** Written over recipient columns that must stay non-null. */
const DELETED_RECIPIENT = "deleted";

export type CustomerDeletionResult = {
  /** Customer rows anonymized, one per shop that had this person on file. */
  customerIds: string[];
  /** Stored files removed. Best effort: a failure here never undoes the database work. */
  blobsDeleted: number;
};

/**
 * Anonymize the signed-in customer and every other shop's record of the same
 * person. "The same person" is the same email: they proved they own it by
 * signing in, and the app already treats those records as one account (the
 * customer login's list of past shops). Without an email only this record goes.
 */
export async function deleteCustomerAccount(input: {
  shopId: string;
  customerId: string;
}): Promise<CustomerDeletionResult | null> {
  const signedIn = await prisma.customer.findFirst({
    where: { id: input.customerId, shopId: input.shopId },
    select: { id: true, email: true },
  });
  if (!signedIn) return null;

  const email = signedIn.email?.trim() || null;
  const records = email
    ? await prisma.customer.findMany({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, shopId: true, email: true, imageUrl: true },
      })
    : [{ id: signedIn.id, shopId: input.shopId, email: null, imageUrl: null }];

  const filePaths = new Set<string>();

  for (const record of records) {
    const paths = await anonymizeCustomer(record);
    for (const path of paths) filePaths.add(path);
  }

  const blobsDeleted = await deleteFiles([...filePaths]);
  return { customerIds: records.map((r) => r.id), blobsDeleted };
}

/** One shop's record of the person. Returns the stored files it no longer needs. */
async function anonymizeCustomer(record: {
  id: string;
  shopId: string;
  email: string | null;
}): Promise<string[]> {
  const { id: customerId, shopId } = record;
  const email = record.email?.trim() || null;

  // Gather files before the rows that point at them are gone.
  const [customer, attachments, assets] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { imageUrl: true } }),
    prisma.messageAttachment.findMany({
      where: { shopId, message: { conversation: { customerId } } },
      select: { url: true },
    }),
    prisma.blobAsset.findMany({
      where: { shopId, customerId, kind: { in: ["chat", "customer-upload"] } },
      select: { pathname: true },
    }),
  ]);

  const candidates = new Set<string>();
  for (const url of [customer?.imageUrl, ...attachments.map((a) => a.url)]) {
    const path = storedFilePathname(url);
    if (path) candidates.add(path);
  }
  for (const asset of assets) candidates.add(asset.pathname);

  await prisma.$transaction(async (tx) => {
    // Messages, attachments, reactions and reminder emails cascade from the conversation.
    await tx.conversation.deleteMany({ where: { shopId, customerId } });
    // Recordings, transcripts and the caller's number. Legs cascade.
    await tx.call.deleteMany({ where: { shopId, customerId } });
    await tx.chatSession.deleteMany({ where: { shopId, customerId } });
    await tx.magicLinkToken.deleteMany({ where: { shopId, customerId } });
    await tx.pushToken.deleteMany({ where: { shopId, customerId } });
    await tx.reviewRequest.deleteMany({ where: { shopId, customerId } });
    await tx.waitlistEntry.deleteMany({
      where: {
        shopId,
        OR: [
          { customerId },
          ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
        ],
      },
    });

    // Kept for the shop's books and the bike's service history, minus the person.
    await tx.job.updateMany({
      where: { shopId, customerId },
      data: { collectionAddress: null, customerNotes: null },
    });
    await tx.jobEmail.updateMany({
      where: { shopId, job: { customerId } },
      data: { recipient: DELETED_RECIPIENT },
    });
    await tx.jobSms.updateMany({
      where: { shopId, job: { customerId } },
      data: { recipient: DELETED_RECIPIENT },
    });
    await tx.rentalReservation.updateMany({
      where: { shopId, customerId },
      data: {
        customerName: DELETED_CUSTOMER_NAME,
        customerEmail: null,
        customerPhone: null,
        notes: null,
      },
    });
    // Bikes stay: deleting one cascades into the shop's installed-component
    // history. A nickname is the only field on it that can name a person.
    await tx.bike.updateMany({ where: { shopId, customerId }, data: { nickname: null } });

    await tx.blobAsset.deleteMany({
      where: { shopId, customerId, kind: { in: ["chat", "customer-upload"] } },
    });

    await tx.customer.update({
      where: { id: customerId },
      data: {
        firstName: DELETED_CUSTOMER_NAME,
        lastName: null,
        email: null,
        phone: null,
        address: null,
        notes: null,
        imageUrl: null,
        emailUpdatesConsent: false,
        emailUpdatesConsentSource: null,
        emailUpdatesConsentUpdatedAt: new Date(),
        smsConsent: false,
        smsConsentSource: null,
        smsConsentCapturedBy: null,
        smsConsentUpdatedAt: new Date(),
        provisional: false,
      },
    });
    // A dozen statements in one go; Prisma's 5s default is tight over the pooler.
  }, { timeout: 20_000 });

  return filesNoLongerReferenced([...candidates]);
}

/**
 * Drop any file the shop's own records still show: a chat photo can be the
 * one staff put on the job's bike, and that photo stays with the job.
 */
async function filesNoLongerReferenced(paths: string[]): Promise<string[]> {
  const free: string[] = [];
  for (const path of paths) {
    const encoded = encodeURIComponent(path);
    const urlMatch = (field: "imageUrl") => ({
      OR: [{ [field]: { contains: encoded } }, { [field]: { endsWith: `/${path}` } }],
    });
    const [jobBike, bike] = await Promise.all([
      prisma.jobBike.findFirst({ where: urlMatch("imageUrl"), select: { id: true } }),
      prisma.bike.findFirst({ where: urlMatch("imageUrl"), select: { id: true } }),
    ]);
    if (!jobBike && !bike) free.push(path);
  }
  return free;
}

/**
 * A stored file's Blob pathname from what a row holds: the private proxy URL
 * (`/api/blob?path=…`) or a direct Blob store URL. Null for anything else,
 * such as an external image link.
 */
export function storedFilePathname(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("/api/blob?")) {
    const params = new URLSearchParams(trimmed.slice("/api/blob?".length));
    return normalizeBlobPathname(params.get("path"));
  }
  if (/^https?:\/\//i.test(trimmed)) return normalizeBlobPathname(trimmed);
  return null;
}

async function deleteFiles(paths: string[]): Promise<number> {
  if (paths.length === 0 || !process.env.BLOB_READ_WRITE_TOKEN) return 0;
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    try {
      await del(batch);
      deleted += batch.length;
    } catch (error) {
      console.error("[account-deletion] blob delete failed", { count: batch.length, error });
    }
  }
  return deleted;
}

/** Remove one staff login. Its push tokens and reset links cascade. */
export async function deleteStaffLogin(input: { shopId: string; userId: string }): Promise<boolean> {
  const { count } = await prisma.user.deleteMany({
    where: { id: input.userId, shopId: input.shopId },
  });
  return count > 0;
}
