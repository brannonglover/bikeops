/**
 * One customer per phone, against staging.
 *
 * A stranger's call or text leaves a provisional "(404) …" placeholder. Adding
 * that person as a real customer used to create a second row on the same
 * number; it now fills in the placeholder. Rows that were already split get
 * merged, and the merge has to carry the call history and end with one thread.
 *
 *   npm run test:customer-dedupe:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTestShop,
  loadTestEnv,
  request,
  type TestShop,
} from "./test-support/route-harness";
import { installPhoneMetadataShim } from "./test-support/phone-metadata-shim";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let customers: typeof import("@/app/api/customers/route");
let merge: typeof import("@/app/api/customers/[id]/merge/route");
let customerRoute: typeof import("@/app/api/customers/[id]/route");
let S: TestShop;

const pp = (id: string) => ({ params: Promise.resolve({ id }) });

async function placeholder(phone: string) {
  return prisma.customer.create({
    data: { shopId: S.id, firstName: phone, phone, provisional: true },
  });
}

async function threadWithMessage(customerId: string, body: string, updatedAt: Date) {
  const c = await prisma.conversation.create({
    data: { shopId: S.id, customerId, jobId: null },
  });
  await prisma.message.create({
    data: { shopId: S.id, conversationId: c.id, sender: "CUSTOMER", body },
  });
  // updatedAt is @updatedAt; a raw write is the only way to backdate it.
  await prisma.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${updatedAt} WHERE id = ${c.id}`;
  return c;
}

async function call(customerId: string, conversationId: string, from: string) {
  return prisma.call.create({
    data: {
      shopId: S.id,
      customerId,
      conversationId,
      direction: "INBOUND",
      status: "COMPLETED",
      fromNumber: from,
      toNumber: "+14045550000",
      twilioParentCallSid: `CA${RUN}${Math.random().toString(36).slice(2)}`,
    },
  });
}

async function postCustomer(body: Record<string, unknown>) {
  const res = await customers.POST(
    request("POST", "/api/customers", { host: S.host, as: S, body })
  );
  assert.equal(res.status, 200);
  return (await res.json()) as { id: string; firstName: string; provisional: boolean; email: string | null };
}

function mergeRequest(targetId: string, sourceCustomerId: string) {
  return merge.POST(
    request("POST", `/api/customers/${targetId}/merge`, {
      host: S.host,
      as: S,
      body: { sourceCustomerId },
    }),
    pp(targetId)
  );
}

async function postMerge(targetId: string, sourceCustomerId: string) {
  const res = await mergeRequest(targetId, sourceCustomerId);
  assert.equal(res.status, 200, await res.clone().text());
}

function patchCustomer(id: string, body: Record<string, unknown>) {
  return customerRoute.PATCH(
    request("PATCH", `/api/customers/${id}`, { host: S.host, as: S, body }),
    pp(id)
  );
}

async function activeThreads(customerId: string) {
  return prisma.conversation.findMany({
    where: { shopId: S.id, customerId, archived: false },
  });
}

describe("one customer per phone", { skip: !ENABLED }, () => {
  before(async () => {
    loadTestEnv();
    installPhoneMetadataShim();
    ({ prisma } = await import("@/lib/db"));
    customers = await import("@/app/api/customers/route");
    merge = await import("@/app/api/customers/[id]/merge/route");
    customerRoute = await import("@/app/api/customers/[id]/route");
    S = await createTestShop(prisma, `cdup-${RUN}`);
  });

  after(async () => {
    if (S) await prisma.shop.deleteMany({ where: { id: S.id } });
    await prisma?.$disconnect();
  });

  it("adding a customer on a placeholder's number fills in the placeholder", async () => {
    const phone = "+14047880301";
    const ph = await placeholder(phone);
    const thread = await threadWithMessage(ph.id, "is my bike ready?", new Date());
    const c = await call(ph.id, thread.id, phone);

    // Staff type the number the way people do, not as E.164.
    const created = await postCustomer({
      firstName: "Wei",
      lastName: "Tan",
      email: "wei@example.test",
      phone: "(404) 788-0301",
    });

    assert.equal(created.id, ph.id, "kept the placeholder's id");
    assert.equal(created.firstName, "Wei");
    assert.equal(created.email, "wei@example.test");
    assert.equal(created.provisional, false);

    const onNumber = await prisma.customer.findMany({
      where: { shopId: S.id, phone },
      select: { id: true },
    });
    assert.deepEqual(onNumber.map((r) => r.id), [ph.id], "one customer on the number");
    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(callAfter.customerId, ph.id);
  });

  it("still creates a new row when the number belongs to a real customer, or nobody", async () => {
    const phone = "+14047880302";
    const real = await prisma.customer.create({
      data: { shopId: S.id, firstName: "Parent", phone },
    });
    // A family sharing a phone is real, not a duplicate to fold away.
    const kid = await postCustomer({ firstName: "Kid", phone });
    assert.notEqual(kid.id, real.id);

    const fresh = await postCustomer({ firstName: "Fresh", phone: "+14047880303" });
    assert.equal(fresh.provisional, false);
  });

  it("merging a placeholder into the real customer keeps its calls and leaves one thread", async () => {
    const phone = "+14047880304";
    const real = await prisma.customer.create({
      data: { shopId: S.id, firstName: "Wei chew", lastName: "Tan", phone },
    });
    const realThread = await threadWithMessage(
      real.id,
      "staff: we'll text when it's done",
      new Date(Date.now() - 60 * 60 * 1000)
    );
    const ph = await placeholder(phone);
    const phThread = await threadWithMessage(ph.id, "thanks!", new Date());
    const c = await call(ph.id, phThread.id, phone);
    const waitlist = await prisma.waitlistEntry.create({
      data: {
        shopId: S.id,
        customerId: ph.id,
        firstName: "W",
        lastName: "L",
        email: `w-${RUN}@example.test`,
        phone,
        serviceIds: [],
      },
    });
    const review = await prisma.reviewRequest.create({
      data: { shopId: S.id, customerId: ph.id, recipientEmail: `r-${RUN}@example.test` },
    });
    const push = await prisma.pushToken.create({
      data: { shopId: S.id, customerId: ph.id, token: `tok-${RUN}`, platform: "ios" },
    });

    await postMerge(real.id, ph.id);

    assert.equal(await prisma.customer.findUnique({ where: { id: ph.id } }), null);

    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(callAfter.customerId, real.id, "call history kept");

    const threads = await prisma.conversation.findMany({
      where: { shopId: S.id, customerId: real.id },
    });
    const active = threads.filter((t) => !t.archived);
    assert.equal(active.length, 1, "one active thread");
    assert.ok([realThread.id, phThread.id].includes(active[0].id));
    assert.equal(active[0].jobId, null);
    const bodies = await prisma.message.findMany({
      where: { conversationId: active[0].id },
      select: { body: true },
    });
    assert.equal(bodies.length, 2, "both threads' messages on the surviving one");
    assert.equal(callAfter.conversationId, active[0].id, "call follows its thread");

    const [w, r, p] = await Promise.all([
      prisma.waitlistEntry.findUniqueOrThrow({ where: { id: waitlist.id } }),
      prisma.reviewRequest.findUniqueOrThrow({ where: { id: review.id } }),
      prisma.pushToken.findUniqueOrThrow({ where: { id: push.id } }),
    ]);
    assert.equal(w.customerId, real.id);
    assert.equal(r.customerId, real.id);
    assert.equal(p.customerId, real.id);

    const merged = await prisma.customer.findUniqueOrThrow({ where: { id: real.id } });
    assert.equal(merged.firstName, "Wei chew");
    assert.equal(merged.provisional, false);
  });

  it("merging a real customer into a placeholder takes the real name", async () => {
    const phone = "+14047880305";
    const ph = await placeholder(phone);
    const real = await prisma.customer.create({
      data: { shopId: S.id, firstName: "Ada", lastName: "Byrne", email: `ada-${RUN}@example.test`, phone },
    });

    await postMerge(ph.id, real.id);

    const merged = await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } });
    assert.equal(merged.provisional, false);
    assert.equal(merged.firstName, "Ada");
    assert.equal(merged.lastName, "Byrne");
    assert.equal(merged.email, `ada-${RUN}@example.test`);
  });
  it("a second merge of the same placeholder changes nothing", async () => {
    const phone = "+14047880306";
    const real = await prisma.customer.create({ data: { shopId: S.id, firstName: "Twice", phone } });
    const ph = await placeholder(phone);
    await threadWithMessage(ph.id, "hello", new Date());

    // A double tap: both requests race for the same source.
    const [a, b] = await Promise.all([mergeRequest(real.id, ph.id), mergeRequest(real.id, ph.id)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 404]);
    assert.equal((await activeThreads(real.id)).length, 1);
  });

  it("editing a customer's phone to a placeholder's number folds the placeholder in", async () => {
    const phone = "+14047880307";
    const real = await prisma.customer.create({
      data: {
        shopId: S.id,
        firstName: "Edit",
        phone: "+14047880399",
        smsConsent: true,
        smsConsentSource: "PHONE_VERBAL",
        smsConsentUpdatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    await threadWithMessage(real.id, "staff: hi", new Date(Date.now() - 60 * 1000));
    const ph = await placeholder(phone);
    // The person on that number replied STOP after the old consent was taken.
    await prisma.customer.update({
      where: { id: ph.id },
      data: { smsConsent: false, smsConsentSource: "SMS_STOP", smsConsentUpdatedAt: new Date() },
    });
    const phThread = await threadWithMessage(ph.id, "STOP", new Date());
    const c = await call(ph.id, phThread.id, phone);

    const res = await patchCustomer(real.id, { phone: "(404) 788-0307" });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.equal(body.mergedPlaceholderId, ph.id);
    assert.equal(body.id, real.id, "the edited customer is the one kept");

    assert.equal(await prisma.customer.findUnique({ where: { id: ph.id } }), null);
    assert.equal((await prisma.call.findUniqueOrThrow({ where: { id: c.id } })).customerId, real.id);
    assert.equal((await activeThreads(real.id)).length, 1);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: real.id } });
    assert.equal(after.phone, phone);
    assert.equal(after.firstName, "Edit");
    assert.equal(after.smsConsent, false, "a later STOP from that number wins");
  });

  it("asks before folding in a placeholder that has a job, and saves nothing until confirmed", async () => {
    const phone = "+14047880308";
    const real = await prisma.customer.create({
      data: { shopId: S.id, firstName: "Careful", phone: "+14047880398" },
    });
    const ph = await placeholder(phone);
    const job = await prisma.job.create({
      data: { shopId: S.id, customerId: ph.id, bikeMake: "Trek", bikeModel: "FX" },
    });

    const first = await patchCustomer(real.id, { phone, notes: "edited" });
    assert.equal(first.status, 409);
    const ask = await first.json();
    assert.equal(ask.code, "PLACEHOLDER_MERGE_NEEDS_CONFIRMATION");
    assert.equal(ask.placeholder.id, ph.id);
    assert.equal(ask.placeholder.records.jobs, 1);
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: real.id } });
    assert.equal(untouched.phone, "+14047880398", "the edit rolled back too");
    assert.equal(untouched.notes, null);
    assert.ok(await prisma.customer.findUnique({ where: { id: ph.id } }));

    const confirmed = await patchCustomer(real.id, { phone, notes: "edited", mergePlaceholderId: ph.id });
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).customerId, real.id);
    assert.equal(await prisma.customer.findUnique({ where: { id: ph.id } }), null);
  });

  it("never folds together two established customers on one number", async () => {
    const phone = "+14047880309";
    const parent = await prisma.customer.create({ data: { shopId: S.id, firstName: "Parent", phone } });
    const kid = await prisma.customer.create({
      data: { shopId: S.id, firstName: "Kid", phone: "+14047880397" },
    });

    const res = await patchCustomer(kid.id, { phone });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mergedPlaceholderId, null);
    assert.ok(await prisma.customer.findUnique({ where: { id: parent.id } }));
  });
});
