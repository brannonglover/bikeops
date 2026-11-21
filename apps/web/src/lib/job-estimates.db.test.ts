/**
 * Estimates: nothing reaches the bill until the customer approves it, an
 * answer lands exactly once, and the job returns to the stage it left —
 * through the real route handlers, against staging.
 *
 *   npm run test:estimates:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let estimatesRoute: typeof import("@/app/api/jobs/[id]/estimates/route");
let respondRoute: typeof import("@/app/api/jobs/[id]/estimates/[estimateId]/respond/route");
let cancelRoute: typeof import("@/app/api/jobs/[id]/estimates/[estimateId]/cancel/route");
let accessToken: (shopId: string, jobId: string) => string;

let S: TestShop;
let serviceId: string;
let productId: string;
let jobId: string;

type EstimateJson = {
  id: string;
  status: string;
  total: number;
  approvedTotal: number;
  items: { id: string; kind: string; name: string; unitPrice: number; decision: string }[];
};

async function send(body: unknown) {
  return estimatesRoute.POST(
    request("POST", `/api/jobs/${jobId}/estimates`, { host: S.host, as: S, body }),
    { params: { id: jobId } }
  );
}

async function sendStandard(): Promise<EstimateJson> {
  const res = await send({
    message: "Chain is worn past 0.75%",
    items: [
      { serviceId, unitPrice: 25 },
      { productId, quantity: 2 },
      { name: "True rear wheel", unitPrice: 30 },
    ],
  });
  assert.equal(res.status, 200, await res.clone().text());
  return ((await res.json()) as { estimate: EstimateJson }).estimate;
}

/** As the customer: signed out, holding the tracking link's access token. */
async function respondAsCustomer(estimateId: string, body: unknown, access: string | null = accessToken(S.id, jobId)) {
  const q = access ? `?access=${encodeURIComponent(access)}` : "";
  return respondRoute.POST(
    request("POST", `/api/jobs/${jobId}/estimates/${estimateId}/respond${q}`, { host: S.host, body }),
    { params: { id: jobId, estimateId } }
  );
}

const jobLines = async () => {
  const [services, products] = await Promise.all([
    prisma.jobService.findMany({ where: { jobId } }),
    prisma.jobProduct.findMany({ where: { jobId } }),
  ]);
  return { services, products };
};
const stage = async () => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).stage;
const stock = async () => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

describe("job estimates", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    estimatesRoute = await import("@/app/api/jobs/[id]/estimates/route");
    respondRoute = await import("@/app/api/jobs/[id]/estimates/[estimateId]/respond/route");
    cancelRoute = await import("@/app/api/jobs/[id]/estimates/[estimateId]/cancel/route");
    ({ createJobCustomerAccessToken: accessToken } = await import("@/lib/job-customer-access"));
    S = await createTestShop(prisma, `zzest-${RUN}`);
  });

  beforeEach(async () => {
    const service = await prisma.service.create({
      data: { shopId: S.id, name: `Chain replacement ${RUN}`, price: 20 },
    });
    serviceId = service.id;
    const product = await prisma.product.create({
      data: { shopId: S.id, name: `Chain 11sp ${RUN}`, price: 45, stockQuantity: 5 },
    });
    productId = product.id;
    const job = await prisma.job.create({
      data: { shopId: S.id, bikeMake: "Trek", bikeModel: "Domane", stage: "RECEIVED" },
    });
    jobId = job.id;
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: S?.id } });
    await prisma.$disconnect();
  });

  it("sending puts the job on hold without touching the bill", async () => {
    const estimate = await sendStandard();
    assert.equal(estimate.status, "SENT");
    assert.equal(estimate.total, 25 + 90 + 30);
    assert.deepEqual(
      estimate.items.map((i) => [i.kind, i.unitPrice]),
      [["SERVICE", 25], ["PRODUCT", 45], ["CUSTOM", 30]]
    );
    assert.equal(await stage(), "WAITING_ON_CUSTOMER");
    const lines = await jobLines();
    assert.equal(lines.services.length + lines.products.length, 0);
    assert.equal(await stock(), 5);
  });

  it("the customer's answer adds only approved items, once, and resumes the job", async () => {
    const estimate = await sendStandard();
    const [svc, prod, custom] = estimate.items;
    const decisions = { [svc.id]: "APPROVED", [prod.id]: "APPROVED", [custom.id]: "DECLINED" };

    const res = await respondAsCustomer(estimate.id, { decisions, comment: "Go ahead" });
    assert.equal(res.status, 200, await res.clone().text());
    const answered = ((await res.json()) as { estimate: EstimateJson }).estimate;
    assert.equal(answered.status, "RESPONDED");
    assert.equal(answered.approvedTotal, 25 + 90);

    const lines = await jobLines();
    assert.equal(lines.services.length, 1);
    assert.equal(lines.services[0].serviceId, serviceId);
    assert.equal(Number(lines.services[0].unitPrice), 25, "quoted price, not catalog price");
    assert.equal(lines.products.length, 1);
    assert.equal(lines.products[0].quantity, 2);
    assert.equal(await stock(), 3);
    assert.equal(await stage(), "RECEIVED");

    const again = await respondAsCustomer(estimate.id, { decisions });
    assert.equal(again.status, 409);
    const after = await jobLines();
    assert.equal(after.services.length + after.products.length, 2);
  });

  it("every item needs a decision, and the link must be the job's", async () => {
    const estimate = await sendStandard();
    const partial = await respondAsCustomer(estimate.id, {
      decisions: { [estimate.items[0].id]: "APPROVED" },
    });
    assert.equal(partial.status, 400);

    const all = Object.fromEntries(estimate.items.map((i) => [i.id, "APPROVED"]));
    assert.equal((await respondAsCustomer(estimate.id, { decisions: all }, null)).status, 403);
    assert.equal((await respondAsCustomer(estimate.id, { decisions: all }, "not-the-token")).status, 403);
    assert.equal((await prisma.jobEstimate.findUniqueOrThrow({ where: { id: estimate.id } })).status, "SENT");
  });

  it("one open estimate at a time; withdrawing restores the stage and blocks answers", async () => {
    const estimate = await sendStandard();
    assert.equal((await send({ items: [{ name: "Brake bleed", unitPrice: 40 }] })).status, 409);

    const res = await cancelRoute.POST(
      request("POST", `/api/jobs/${jobId}/estimates/${estimate.id}/cancel`, { host: S.host, as: S }),
      { params: { id: jobId, estimateId: estimate.id } }
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(await stage(), "RECEIVED");

    const all = Object.fromEntries(estimate.items.map((i) => [i.id, "APPROVED"]));
    assert.equal((await respondAsCustomer(estimate.id, { decisions: all })).status, 409);
    const lines = await jobLines();
    assert.equal(lines.services.length + lines.products.length, 0);

    // The customer's view leaves out the withdrawn one; staff still see it.
    const access = encodeURIComponent(accessToken(S.id, jobId));
    const customerView = await estimatesRoute.GET(
      request("GET", `/api/jobs/${jobId}/estimates?access=${access}`, { host: S.host }),
      { params: { id: jobId } }
    );
    assert.equal(((await customerView.json()) as { estimates: unknown[] }).estimates.length, 0);
    const staffView = await estimatesRoute.GET(
      request("GET", `/api/jobs/${jobId}/estimates`, { host: S.host, as: S }),
      { params: { id: jobId } }
    );
    assert.equal(((await staffView.json()) as { estimates: unknown[] }).estimates.length, 1);
  });

  it("the job stays put if staff moved it while the estimate was out", async () => {
    const estimate = await sendStandard();
    await prisma.job.update({ where: { id: jobId }, data: { stage: "WAITING_ON_PARTS" } });
    const all = Object.fromEntries(estimate.items.map((i) => [i.id, "DECLINED"]));
    assert.equal((await respondAsCustomer(estimate.id, { decisions: all })).status, 200);
    assert.equal(await stage(), "WAITING_ON_PARTS");
  });

  it("sending without the hold leaves the stage alone", async () => {
    const res = await send({ items: [{ name: "Bar tape", unitPrice: 20 }], waitOnCustomer: false });
    assert.equal(res.status, 200);
    assert.equal(await stage(), "RECEIVED");
  });

  it("estimates can't go out on a cancelled job", async () => {
    await prisma.job.update({ where: { id: jobId }, data: { stage: "CANCELLED" } });
    assert.equal((await send({ items: [{ name: "Bar tape", unitPrice: 20 }] })).status, 409);
  });
});
