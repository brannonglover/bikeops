/**
 * Which customer an inbound text or call is matched to when more than one
 * profile shares the number, against staging.
 *
 * The case that started this: a caller left a provisional "(404) …" profile,
 * staff later added the same person as a real customer from New Job, texted
 * them from that thread, and the reply landed in the placeholder's thread.
 *
 *   npm run test:sms-match:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestShop, loadTestEnv, type TestShop } from "./test-support/route-harness";
import { installPhoneMetadataShim } from "./test-support/phone-metadata-shim";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let findCustomerIdBySmsFrom: typeof import("./chat-sms")["findCustomerIdBySmsFrom"];
let S: TestShop;

const PHONE = "+14047880142";

async function customer(firstName: string, phone: string, provisional: boolean) {
  return prisma.customer.create({
    data: { shopId: S.id, firstName, phone, provisional },
    select: { id: true },
  });
}

async function thread(customerId: string, updatedAt: Date) {
  const c = await prisma.conversation.create({
    data: { shopId: S.id, customerId, jobId: null },
  });
  // updatedAt is @updatedAt; a raw write is the only way to backdate it.
  await prisma.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${updatedAt} WHERE id = ${c.id}`;
}

describe("inbound sender matching", { skip: !ENABLED }, () => {
  before(async () => {
    loadTestEnv();
    installPhoneMetadataShim();
    ({ prisma } = await import("@/lib/db"));
    ({ findCustomerIdBySmsFrom } = await import("./chat-sms"));
    S = await createTestShop(prisma, `smsm-${RUN}`);
  });

  after(async () => {
    if (S) await prisma.shop.deleteMany({ where: { id: S.id } });
  });

  it("matches a single customer whatever format the phone was stored in", async () => {
    const only = await customer("Solo", "(404) 788-0199", false);
    assert.equal(await findCustomerIdBySmsFrom(S.id, "+14047880199"), only.id);
    assert.equal(await findCustomerIdBySmsFrom(S.id, "+14047880000"), null);
  });

  it("prefers the real contact over a placeholder, even an older and quieter one", async () => {
    // As it happened: the caller's placeholder exists first, the real contact
    // is added later, and the placeholder's thread is the newest — so neither
    // insertion order nor recency alone would pick the real contact.
    const placeholder = await customer("(404) 788-0142", PHONE, true);
    await thread(placeholder.id, new Date());
    const real = await customer("Wei", PHONE, false);
    await thread(real.id, new Date(Date.now() - 60 * 60 * 1000));

    assert.equal(await findCustomerIdBySmsFrom(S.id, PHONE), real.id);
  });

  it("among real contacts sharing a number, picks the one whose thread was active last", async () => {
    const shared = "+14047880177";
    const quiet = await customer("Parent", shared, false);
    await thread(quiet.id, new Date(Date.now() - 2 * 60 * 60 * 1000));
    const active = await customer("Kid", shared, false);
    await thread(active.id, new Date(Date.now() - 60 * 1000));

    assert.equal(await findCustomerIdBySmsFrom(S.id, shared), active.id);

    // Staff text the other one: that thread is now the live one.
    await thread(quiet.id, new Date());
    assert.equal(await findCustomerIdBySmsFrom(S.id, shared), quiet.id);
  });
});
