import { Prisma, type Customer } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveGeneralConversation } from "@/lib/conversation";
import { findProvisionalCustomerByPhone } from "@/lib/customer-placeholder";
import { normalizePhone } from "@/lib/phone";
import { mergeSmsConsentFields, SMS_CONSENT_SOURCES } from "@/lib/sms-consent";

type Tx = Prisma.TransactionClient;

/** Room for the dozen-plus writes a merge makes over a pooled connection. */
export const MERGE_TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

/** Details the merged customer takes from the source when it has none of its own. */
const FILL_IN_FIELDS = [
  "lastName",
  "email",
  "phone",
  "address",
  "notes",
  "imageUrl",
] as const;

/**
 * Who the merged customer is. A placeholder (a stranger's number standing in
 * for a name) gives way to a real contact's name whichever side it is on, the
 * result is only provisional if both were, and otherwise the target's own
 * details win with blanks filled from the source.
 */
function mergedCustomerFields(
  target: Customer,
  source: Customer
): Prisma.CustomerUncheckedUpdateInput {
  const update: Prisma.CustomerUncheckedUpdateInput = {};
  const takeIdentity = target.provisional && !source.provisional;

  if (takeIdentity) {
    update.firstName = source.firstName;
    update.lastName = source.lastName ?? target.lastName;
  }
  for (const key of FILL_IN_FIELDS) {
    if (takeIdentity && key === "lastName") continue;
    if (target[key] == null && source[key] != null) update[key] = source[key];
  }

  const provisional = target.provisional && source.provisional;
  if (provisional !== target.provisional) update.provisional = provisional;
  if (provisional && !target.provisionalSeenAt && source.provisionalSeenAt) {
    update.provisionalSeenAt = source.provisionalSeenAt;
  }
  return update;
}

function samePhone(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return (normalizePhone(a) ?? a) === (normalizePhone(b) ?? b);
}

/**
 * SMS consent for the merged customer. Opt-in carries over from either side,
 * except that a STOP sent from the number the merged customer keeps wins over
 * an older opt-in: it was the person on that phone saying no.
 */
function mergedConsentFields(
  target: Customer,
  source: Customer,
  keptPhone: string | null
): Prisma.CustomerUncheckedUpdateInput {
  const sourceStopped =
    !source.smsConsent &&
    source.smsConsentSource === SMS_CONSENT_SOURCES.SMS_STOP &&
    source.smsConsentUpdatedAt !== null;
  if (
    sourceStopped &&
    samePhone(source.phone, keptPhone) &&
    (!target.smsConsentUpdatedAt ||
      target.smsConsentUpdatedAt < source.smsConsentUpdatedAt!)
  ) {
    return {
      smsConsent: false,
      smsConsentSource: source.smsConsentSource,
      smsConsentUpdatedAt: source.smsConsentUpdatedAt,
      smsConsentCapturedBy: null,
    };
  }
  return mergeSmsConsentFields(target, source);
}

/**
 * Locks both customer rows for the rest of the transaction, in id order so two
 * merges touching the same pair can't deadlock. A second merge of the same
 * source waits here and then finds the source gone.
 */
async function lockCustomers(tx: Tx, shopId: string, ids: string[]) {
  const sorted = [...ids].sort();
  await tx.$queryRaw`
    SELECT id FROM "Customer"
    WHERE "shopId" = ${shopId} AND id IN (${Prisma.join(sorted)})
    ORDER BY id
    FOR UPDATE
  `;
}

export type MergeOutcome = "merged" | "source-missing" | "target-missing";

/**
 * Moves everything the source customer owns onto the target, folds their chat
 * threads into one, and deletes the source — inside the caller's transaction,
 * so a failure anywhere leaves both customers as they were.
 *
 * Re-reads both rows under a row lock, so the caller's earlier reads are only a
 * hint: a source that is already gone reports "source-missing" and nothing is
 * written. `requireProvisionalSource` makes the same check for "still a
 * placeholder", so an automatic merge never folds away an established customer.
 */
export async function mergeCustomerInto(
  tx: Tx,
  shopId: string,
  targetId: string,
  sourceId: string,
  options: { requireProvisionalSource?: boolean } = {}
): Promise<MergeOutcome> {
  await lockCustomers(tx, shopId, [targetId, sourceId]);
  const [target, source] = await Promise.all([
    tx.customer.findFirst({ where: { id: targetId, shopId } }),
    tx.customer.findFirst({ where: { id: sourceId, shopId } }),
  ]);
  if (!target) return "target-missing";
  if (!source) return "source-missing";
  if (options.requireProvisionalSource && !source.provisional) return "source-missing";

  const fields = mergedCustomerFields(target, source);
  const keptPhone =
    typeof fields.phone === "string" ? fields.phone : target.phone;
  const customerUpdate = {
    ...fields,
    ...mergedConsentFields(target, source, keptPhone),
  };
  if (Object.keys(customerUpdate).length > 0) {
    await tx.customer.update({ where: { id: targetId }, data: customerUpdate });
  }

  const move = { where: { customerId: sourceId, shopId }, data: { customerId: targetId } };
  await tx.bike.updateMany(move);
  await tx.job.updateMany(move);
  await tx.conversation.updateMany(move);

  // Each side brought a general thread; fold them into one so staff and the
  // customer see a single conversation. resolveGeneralConversation runs
  // consolidateCustomerConversations under the advisory lock inbound texts
  // take, so a text arriving mid-merge can't open a third thread.
  const thread = await resolveGeneralConversation(shopId, targetId, tx);

  // Call.customerId is SetNull on delete, so anything not moved here would lose
  // its link to the customer when the source row goes.
  await tx.call.updateMany(move);
  if (thread) {
    // Calls filed on a thread the consolidation just archived follow the
    // messages to the surviving one.
    await tx.call.updateMany({
      where: {
        shopId,
        customerId: targetId,
        conversationId: { not: null },
        NOT: { conversationId: thread.id },
      },
      data: { conversationId: thread.id },
    });
  }

  await tx.waitlistEntry.updateMany(move);
  await tx.reviewRequest.updateMany(move);
  await tx.rentalReservation.updateMany(move);
  // Cascade-deleted with the customer, so a device signed in as the source
  // would stop getting notifications.
  await tx.pushToken.updateMany(move);

  await tx.magicLinkToken.deleteMany({ where: { customerId: sourceId } });
  await tx.chatSession.deleteMany({ where: { customerId: sourceId } });
  await tx.customer.delete({ where: { id: sourceId } });
  return "merged";
}

/** What a placeholder holds beyond its texts and calls, which staff confirm before it is folded in. */
export type PlaceholderRecords = {
  jobs: number;
  bikes: number;
  waitlistEntries: number;
  rentalReservations: number;
};

async function countPlaceholderRecords(
  tx: Tx,
  shopId: string,
  customerId: string
): Promise<PlaceholderRecords> {
  const where = { shopId, customerId };
  const [jobs, bikes, waitlistEntries, rentalReservations] = await Promise.all([
    tx.job.count({ where }),
    tx.bike.count({ where }),
    tx.waitlistEntry.count({ where }),
    tx.rentalReservation.count({ where }),
  ]);
  return { jobs, bikes, waitlistEntries, rentalReservations };
}

function describeRecords(records: PlaceholderRecords): string {
  const parts = [
    [records.jobs, "job"],
    [records.bikes, "bike"],
    [records.waitlistEntries, "waitlist entry"],
    [records.rentalReservations, "rental"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) =>
      n === 1 ? `1 ${label}` : `${n} ${label === "waitlist entry" ? "waitlist entries" : `${label}s`}`
    )
    .join(", ");
}

/**
 * Thrown when a phone edit would fold in a placeholder that has jobs or other
 * records of its own. Nothing has been written; the caller retries with
 * `confirmedPlaceholderId` once staff agree.
 */
export class PlaceholderMergeNeedsConfirmation extends Error {
  readonly code = "PLACEHOLDER_MERGE_NEEDS_CONFIRMATION";
  constructor(
    readonly placeholder: { id: string; name: string; records: PlaceholderRecords }
  ) {
    super(
      `${placeholder.name} is an unnamed contact on this number with ${describeRecords(
        placeholder.records
      )}. Saving will merge it into this customer, moving its messages, calls and records here.`
    );
  }

  toJSON() {
    return { error: this.message, code: this.code, placeholder: this.placeholder };
  }
}

/**
 * Saves a customer edit and, when it puts a number on the customer that a
 * stranger's placeholder already holds, folds that placeholder in — so one
 * person doesn't end up as two customers on one phone.
 *
 * Only a provisional placeholder is ever folded in; two established customers
 * sharing a number (a family phone) are left alone. A placeholder with jobs,
 * bikes, waitlist entries or rentals needs `confirmedPlaceholderId` set to its
 * id, or this throws PlaceholderMergeNeedsConfirmation without saving. The edit
 * and the merge commit together or not at all, and the edited customer is
 * always the one kept.
 */
export async function updateCustomerFoldingPlaceholder(args: {
  shopId: string;
  customerId: string;
  previousPhone: string | null;
  /** The stored form of the new phone, or undefined when the edit leaves it. */
  newPhone: string | null | undefined;
  update: Prisma.CustomerUncheckedUpdateInput;
  confirmedPlaceholderId?: string | null;
}): Promise<{ customer: Customer; mergedPlaceholderId: string | null }> {
  const { shopId, customerId, newPhone, update } = args;

  const phoneChanged =
    typeof newPhone === "string" && !samePhone(newPhone, args.previousPhone);
  const candidate = phoneChanged
    ? await findProvisionalCustomerByPhone(prisma, shopId, newPhone)
    : null;

  if (!candidate || candidate.id === customerId) {
    const customer = await prisma.customer.update({ where: { id: customerId }, data: update });
    return { customer, mergedPlaceholderId: null };
  }

  return prisma.$transaction(async (tx) => {
    await lockCustomers(tx, shopId, [customerId, candidate.id]);
    const customer = await tx.customer.update({ where: { id: customerId }, data: update });

    // Re-read under the lock: another save may have merged or named it meanwhile.
    const placeholder = await tx.customer.findFirst({
      where: { id: candidate.id, shopId, provisional: true },
      select: { id: true },
    });
    if (!placeholder) return { customer, mergedPlaceholderId: null };

    const records = await countPlaceholderRecords(tx, shopId, candidate.id);
    const hasRecords = Object.values(records).some((n) => n > 0);
    if (hasRecords && args.confirmedPlaceholderId !== candidate.id) {
      // Throwing rolls back the edit too: staff see the question before anything changes.
      throw new PlaceholderMergeNeedsConfirmation({
        id: candidate.id,
        name: candidate.firstName,
        records,
      });
    }

    const outcome = await mergeCustomerInto(tx, shopId, customerId, candidate.id, {
      requireProvisionalSource: true,
    });
    if (outcome !== "merged") return { customer, mergedPlaceholderId: null };
    const merged = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    return { customer: merged, mergedPlaceholderId: candidate.id };
  }, MERGE_TRANSACTION_OPTIONS);
}
