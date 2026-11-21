import type { Customer, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { SMS_CONSENT_SOURCES } from "@/lib/sms-consent";

type Db = Prisma.TransactionClient | typeof prisma;

/** The columns a staff-entered new customer can carry. */
export type NewCustomerData = Pick<
  Prisma.CustomerUncheckedCreateInput,
  | "shopId"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "address"
  | "notes"
  | "smsConsent"
  | "smsConsentSource"
  | "smsConsentUpdatedAt"
  | "smsConsentCapturedBy"
>;

const SMS_CONSENT_KEYS = [
  "smsConsent",
  "smsConsentSource",
  "smsConsentUpdatedAt",
  "smsConsentCapturedBy",
] as const;

/**
 * The shop's placeholder contact for this number, if a stranger's call or text
 * left one. Stored phones are not all E.164, so the match is on the normalized
 * number rather than the raw column.
 */
export async function findProvisionalCustomerByPhone(
  db: Db,
  shopId: string,
  phone: string | null | undefined
): Promise<Customer | null> {
  const e164 = phone ? normalizePhone(phone) : null;
  if (!e164) return null;
  const candidates = await db.customer.findMany({
    where: { shopId, provisional: true, phone: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  return candidates.find((c) => c.phone && normalizePhone(c.phone) === e164) ?? null;
}

/**
 * Creates a customer, or — when the number already belongs to a placeholder
 * left by a stranger's call or text — fills in that placeholder instead.
 *
 * Creating a second row would leave two customers on one phone, with the
 * caller's history on the placeholder and the job on the new row. Filling in
 * the placeholder keeps its id, so its thread and calls stay attached.
 *
 * Only for details staff entered: a public form could otherwise name someone
 * else's number and take over that number's thread.
 */
export async function createCustomerAbsorbingPlaceholder(
  db: Db,
  data: NewCustomerData
): Promise<{ customer: Customer; absorbed: boolean }> {
  const placeholder = await findProvisionalCustomerByPhone(db, data.shopId, data.phone);
  if (placeholder) {
    const update: Prisma.CustomerUncheckedUpdateManyInput = { provisional: false };
    for (const [key, value] of Object.entries(data)) {
      if (key === "shopId") continue;
      // A blank field means "not given" — it doesn't wipe what the placeholder has.
      if (value !== null && value !== undefined) {
        (update as Record<string, unknown>)[key] = value;
      }
    }
    // A number that replied STOP stays opted out until the customer opts back in.
    if (
      placeholder.smsConsentSource === SMS_CONSENT_SOURCES.SMS_STOP &&
      !placeholder.smsConsent
    ) {
      for (const key of SMS_CONSENT_KEYS) delete update[key];
    }

    // Conditional on still being provisional, so two saves racing for the same
    // placeholder can't both claim it; the loser creates its own row.
    const { count } = await db.customer.updateMany({
      where: { id: placeholder.id, provisional: true },
      data: update,
    });
    if (count === 1) {
      const customer = await db.customer.findUniqueOrThrow({
        where: { id: placeholder.id },
      });
      return { customer, absorbed: true };
    }
  }

  const customer = await db.customer.create({ data });
  return { customer, absorbed: false };
}
