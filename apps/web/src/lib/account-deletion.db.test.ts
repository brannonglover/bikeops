/**
 * In-app account deletion against staging. A customer's deletion anonymizes
 * every shop's record of their email and keeps the shop's jobs and payments; a
 * staff member's deletion removes only their login and signs it out everywhere.
 *
 *   npm run test:security:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let customerRoute: typeof import("@/app/api/chat/account/route");
let staffRoute: typeof import("@/app/api/account/route");
let mechanics: typeof import("@/app/api/mechanics/route");
let lib: typeof import("./account-deletion");

let A: TestShop;
let B: TestShop;

async function customerWithHistory(shop: TestShop, email: string) {
  const customer = await prisma.customer.create({
    data: {
      shopId: shop.id,
      firstName: "Pat",
      lastName: "Rider",
      email,
      phone: "+15555550100",
      address: "1 Main St",
      notes: "Prefers texts",
      smsConsent: true,
    },
  });
  const bike = await prisma.bike.create({
    data: { shopId: shop.id, customerId: customer.id, make: "Trek", model: "Domane", nickname: "Pat's bike" },
  });
  const job = await prisma.job.create({
    data: {
      shopId: shop.id,
      customerId: customer.id,
      bikeMake: "Trek",
      bikeModel: "Domane",
      collectionAddress: "1 Main St",
      customerNotes: "Squeaky brakes",
      jobBikes: { create: { shopId: shop.id, make: "Trek", model: "Domane", bikeId: bike.id } },
      payments: { create: { shopId: shop.id, amount: 42, status: "succeeded", paymentMethod: "card" } },
      sentEmails: { create: { shopId: shop.id, templateSlug: "ready", recipient: email } },
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      shopId: shop.id,
      customerId: customer.id,
      messages: { create: { shopId: shop.id, sender: "CUSTOMER", body: "When is it ready?" } },
    },
  });
  await prisma.call.create({
    data: {
      shopId: shop.id,
      customerId: customer.id,
      direction: "INBOUND",
      status: "COMPLETED",
      fromNumber: "+15555550100",
      toNumber: "+15555550199",
      twilioParentCallSid: `CA${randomBytes(16).toString("hex")}`,
      transcriptionText: "Hi, it's Pat",
    },
  });
  await prisma.waitlistEntry.create({
    data: { shopId: shop.id, firstName: "Pat", lastName: "Rider", email, phone: "+15555550100" },
  });
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 86_400_000);
  await prisma.chatSession.create({ data: { shopId: shop.id, customerId: customer.id, token, expiresAt } });
  return { customer, job, conversation, token };
}

function deleteCustomer(host: string, token?: string) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  return customerRoute.DELETE(request("DELETE", "/api/chat/account", { host, headers }));
}

describe("account deletion", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    // No real Blob store calls from tests: deleteFiles skips without a token.
    delete process.env.BLOB_READ_WRITE_TOKEN;
    ({ prisma } = await import("@/lib/db"));
    customerRoute = await import("@/app/api/chat/account/route");
    staffRoute = await import("@/app/api/account/route");
    mechanics = await import("@/app/api/mechanics/route");
    lib = await import("./account-deletion");
    A = await createTestShop(prisma, `dela-${RUN}`);
    B = await createTestShop(prisma, `delb-${RUN}`);
  });

  after(async () => {
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) } } });
  });

  it("refuses a signed-out request and a session replayed on another shop's host", async () => {
    const { customer, token } = await customerWithHistory(A, `replay-${RUN}@example.test`);
    assert.equal((await deleteCustomer(A.host)).status, 401);
    assert.equal((await deleteCustomer(B.host, token)).status, 401);
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(untouched.firstName, "Pat");
  });

  it("anonymizes the customer at every shop with their email and keeps the shop's records", async () => {
    const email = `pat-${RUN}@example.test`;
    const a = await customerWithHistory(A, email);
    const b = await customerWithHistory(B, email.toUpperCase());
    const bystander = await customerWithHistory(A, `other-${RUN}@example.test`);

    const res = await deleteCustomer(A.host, a.token);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, records: 2 });

    for (const { customer, job, conversation } of [a, b]) {
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      assert.equal(row.firstName, lib.DELETED_CUSTOMER_NAME);
      assert.equal(row.lastName, null);
      assert.equal(row.email, null);
      assert.equal(row.phone, null);
      assert.equal(row.address, null);
      assert.equal(row.notes, null);
      assert.equal(row.smsConsent, false);

      const kept = await prisma.job.findUniqueOrThrow({
        where: { id: job.id },
        include: { payments: true, sentEmails: true, jobBikes: true },
      });
      assert.equal(kept.customerId, customer.id);
      assert.equal(kept.collectionAddress, null);
      assert.equal(kept.customerNotes, null);
      assert.equal(kept.payments.length, 1);
      assert.equal(kept.sentEmails[0].recipient, "deleted");
      assert.ok(kept.jobBikes[0].bikeId, "the job keeps its bike");

      const bikes = await prisma.bike.findMany({ where: { customerId: customer.id } });
      assert.equal(bikes.length, 1);
      assert.equal(bikes[0].nickname, null);

      assert.equal(await prisma.conversation.count({ where: { id: conversation.id } }), 0);
      assert.equal(await prisma.message.count({ where: { conversationId: conversation.id } }), 0);
      assert.equal(await prisma.call.count({ where: { customerId: customer.id } }), 0);
      assert.equal(await prisma.chatSession.count({ where: { customerId: customer.id } }), 0);
    }
    assert.equal(
      await prisma.waitlistEntry.count({ where: { email: { equals: email, mode: "insensitive" } } }),
      0,
    );

    // The old session no longer signs anyone in.
    assert.equal((await deleteCustomer(A.host, a.token)).status, 401);

    // Another customer of the same shop is untouched.
    const other = await prisma.customer.findUniqueOrThrow({ where: { id: bystander.customer.id } });
    assert.equal(other.firstName, "Pat");
    assert.equal(await prisma.conversation.count({ where: { id: bystander.conversation.id } }), 1);
  });

  it("deletes only the staff member's own login and signs it out", async () => {
    const colleague = await prisma.user.create({
      data: { shopId: A.id, email: `colleague-${RUN}@example.test`, passwordHash: "x" },
    });

    const signedOut = await staffRoute.DELETE(request("DELETE", "/api/account", { host: A.host }));
    assert.equal(signedOut.status, 401);

    // A's session on B's host is refused, and B's staff are untouched.
    const wrongHost = await staffRoute.DELETE(request("DELETE", "/api/account", { host: B.host, as: A }));
    assert.equal(wrongHost.status, 401);

    const res = await staffRoute.DELETE(request("DELETE", "/api/account", { host: A.host, as: A }));
    assert.equal(res.status, 200);

    assert.equal(await prisma.user.count({ where: { id: A.userId } }), 0);
    assert.equal(await prisma.user.count({ where: { id: colleague.id } }), 1);
    assert.equal(await prisma.user.count({ where: { id: B.userId } }), 1);
    assert.equal(await prisma.shop.count({ where: { id: A.id } }), 1, "the shop stays");

    const after = await mechanics.GET(request("GET", "/api/mechanics", { host: A.host, as: A }));
    assert.equal(after.status, 401, "the deleted login's session no longer works");
  });
});
