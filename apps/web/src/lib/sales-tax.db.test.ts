/**
 * Sales tax and discounts reach what the customer is actually charged, and a
 * settings change never rewrites a bill someone already paid against —
 * through the real route handlers, against staging.
 *
 *   npm run test:tax:db
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
let jobRoute: typeof import("@/app/api/jobs/[id]/route");
let jobsRoute: typeof import("@/app/api/jobs/route");
let pricingRoute: typeof import("@/app/api/jobs/[id]/pricing/route");
let taxRoute: typeof import("@/app/api/settings/sales-tax/route");
let cashRoute: typeof import("@/app/api/jobs/[id]/payments/record-cash/route");

let S: TestShop;
let serviceId: string;
let productId: string;

const params = (id: string) => ({ params: { id } });

async function setShopTax(body: { salesTaxRatePercent: number; taxServices: boolean; taxProducts: boolean }) {
  const res = await taxRoute.PUT(request("PUT", "/api/settings/sales-tax", { host: S.host, as: S, body }));
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as { jobsUpdated: number };
}

/** A $60 service + 2 × $20 part = $100 of lines, made through the jobs API so it copies shop tax. */
async function newJob(): Promise<string> {
  const res = await jobsRoute.POST(
    request("POST", "/api/jobs", {
      host: S.host,
      as: S,
      body: { bikeMake: "Trek", bikeModel: "FX", bikes: [{ make: "Trek", model: "FX" }], deliveryType: "DROP_OFF_AT_SHOP" },
    })
  );
  assert.equal(res.status, 200, await res.clone().text());
  const { id } = (await res.json()) as { id: string };
  await prisma.jobService.create({ data: { shopId: S.id, jobId: id, serviceId, quantity: 1, unitPrice: 60 } });
  await prisma.jobProduct.create({ data: { shopId: S.id, jobId: id, productId, quantity: 2, unitPrice: 20 } });
  await prisma.job.update({ where: { id }, data: { stage: "WORKING_ON" } });
  return id;
}

async function totals(jobId: string) {
  const res = await jobRoute.GET(request("GET", `/api/jobs/${jobId}`, { host: S.host, as: S }), params(jobId));
  assert.equal(res.status, 200);
  return ((await res.json()) as { totals: { itemsTotal: number; discount: number; tax: number; total: number } }).totals;
}

async function pricing(jobId: string, body: unknown) {
  return pricingRoute.PATCH(request("PATCH", `/api/jobs/${jobId}/pricing`, { host: S.host, as: S, body }), params(jobId));
}

describe("sales tax and discounts", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    jobRoute = await import("@/app/api/jobs/[id]/route");
    jobsRoute = await import("@/app/api/jobs/route");
    pricingRoute = await import("@/app/api/jobs/[id]/pricing/route");
    taxRoute = await import("@/app/api/settings/sales-tax/route");
    cashRoute = await import("@/app/api/jobs/[id]/payments/record-cash/route");
    S = await createTestShop(prisma, `zztax-${RUN}`);
    serviceId = (await prisma.service.create({ data: { shopId: S.id, name: "Tune-up", price: 60 } })).id;
    productId = (await prisma.product.create({ data: { shopId: S.id, name: "Tube", price: 20, stockQuantity: 50 } })).id;
  });

  beforeEach(async () => {
    await setShopTax({ salesTaxRatePercent: 0, taxServices: false, taxProducts: true });
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: S?.id } });
    await prisma.$disconnect();
  });

  it("a shop with no tax set bills exactly the line items, as before", async () => {
    const id = await newJob();
    const t = await totals(id);
    assert.deepEqual([t.itemsTotal, t.discount, t.tax, t.total], [100, 0, 0, 100]);
  });

  it("new jobs copy the shop's tax, and cash collects the taxed total", async () => {
    await setShopTax({ salesTaxRatePercent: 8.25, taxServices: false, taxProducts: true });
    const id = await newJob();
    const t = await totals(id);
    assert.equal(t.tax, 3.3, "8.25% of the $40 of parts only");
    assert.equal(t.total, 103.3);

    const res = await cashRoute.POST(
      request("POST", `/api/jobs/${id}/payments/record-cash`, { host: S.host, as: S, body: {} }),
      params(id)
    );
    assert.equal(res.status, 200, await res.clone().text());
    const paid = await prisma.payment.findMany({ where: { jobId: id } });
    assert.equal(Number(paid[0].amount), 103.3);
  });

  it("changing the rate updates unpaid open jobs but never a paid one", async () => {
    await setShopTax({ salesTaxRatePercent: 5, taxServices: true, taxProducts: true });
    const unpaid = await newJob();
    const paid = await newJob();
    await prisma.payment.create({
      data: { shopId: S.id, jobId: paid, amount: 105, currency: "usd", status: "succeeded", paymentMethod: "cash" },
    });

    const { jobsUpdated } = await setShopTax({ salesTaxRatePercent: 10, taxServices: true, taxProducts: true });
    assert.ok(jobsUpdated >= 1);
    assert.equal((await totals(unpaid)).total, 110);
    assert.equal((await totals(paid)).total, 105, "the paid job keeps the 5% it was charged");
  });

  it("discounts come off before tax; exempt jobs pay none", async () => {
    await setShopTax({ salesTaxRatePercent: 10, taxServices: false, taxProducts: true });
    const id = await newJob();

    assert.equal((await pricing(id, { discountType: "PERCENT", discountValue: 10, discountReason: "Club member" })).status, 200);
    let t = await totals(id);
    assert.equal(t.discount, 10);
    assert.equal(t.tax, 3.6, "10% tax on $40 of parts less their $4 share of the discount");
    assert.equal(t.total, 93.6);

    assert.equal((await pricing(id, { taxExempt: true })).status, 200);
    t = await totals(id);
    assert.equal(t.tax, 0);
    assert.equal(t.total, 90);

    assert.equal((await pricing(id, { discountType: null })).status, 200);
    const row = await prisma.job.findUniqueOrThrow({ where: { id } });
    assert.equal(row.discountType, null);
    assert.equal(row.discountReason, null);
    assert.equal((await pricing(id, { discountType: "PERCENT", discountValue: 150 })).status, 400);
  });

  it("only staff can change pricing", async () => {
    const id = await newJob();
    const res = await pricingRoute.PATCH(
      request("PATCH", `/api/jobs/${id}/pricing`, { host: S.host, body: { discountType: "AMOUNT", discountValue: 99 } }),
      params(id)
    );
    assert.equal(res.status, 401);
  });
});
