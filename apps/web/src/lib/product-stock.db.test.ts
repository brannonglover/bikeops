/**
 * Selling a product on a job takes it off the shelf, and every way the sale is
 * undone puts back exactly what was taken — through the real route handlers,
 * against staging.
 *
 *   npm run test:parts:db
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
let productsRoute: typeof import("@/app/api/jobs/[id]/products/route");

let S: TestShop;
let productId: string;
let jobId: string;

const params = (id: string) => ({ params: { id } });

const stock = async () =>
  (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

async function addLine(quantity: number): Promise<string> {
  const res = await productsRoute.POST(
    request("POST", `/api/jobs/${jobId}/products`, { host: S.host, as: S, body: { productId, quantity } }),
    params(jobId)
  );
  assert.equal(res.status, 200);
  return ((await res.json()) as { id: string }).id;
}

async function setQuantity(jobProductId: string, quantity: number) {
  const res = await productsRoute.PATCH(
    request("PATCH", `/api/jobs/${jobId}/products`, { host: S.host, as: S, body: { jobProductId, quantity } }),
    params(jobId)
  );
  assert.equal(res.status, 200);
}

async function removeLine(jobProductId: string) {
  const res = await productsRoute.DELETE(
    request("DELETE", `/api/jobs/${jobId}/products?jobProductId=${jobProductId}`, { host: S.host, as: S }),
    params(jobId)
  );
  assert.equal(res.status, 200);
}

async function patchJob(body: unknown) {
  const res = await jobRoute.PATCH(
    request("PATCH", `/api/jobs/${jobId}`, { host: S.host, as: S, body }),
    params(jobId)
  );
  assert.equal(res.status, 200, await res.clone().text());
}

describe("product stock follows job sales", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    jobRoute = await import("@/app/api/jobs/[id]/route");
    productsRoute = await import("@/app/api/jobs/[id]/products/route");
    S = await createTestShop(prisma, `zzstock-${RUN}`);
  });

  beforeEach(async () => {
    const product = await prisma.product.create({
      data: { shopId: S.id, name: `Tube 700x25 ${RUN}`, price: 8, stockQuantity: 10 },
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

  it("adding, changing and removing a line moves stock", async () => {
    const line = await addLine(2);
    assert.equal(await stock(), 8);
    await setQuantity(line, 3);
    assert.equal(await stock(), 7);
    await setQuantity(line, 1);
    assert.equal(await stock(), 9);
    await removeLine(line);
    assert.equal(await stock(), 10);
  });

  it("selling past zero goes negative rather than blocking the sale", async () => {
    await addLine(12);
    assert.equal(await stock(), -2);
  });

  it("cancelling returns stock and restoring the job takes it again", async () => {
    await addLine(2);
    assert.equal(await stock(), 8);
    await patchJob({ stage: "CANCELLED", cancellationReason: "Customer changed their mind", notifyCustomer: false });
    assert.equal(await stock(), 10);
    // Lines on a cancelled job don't touch stock.
    const extra = await addLine(1);
    assert.equal(await stock(), 10);
    await removeLine(extra);
    assert.equal(await stock(), 10);
    await patchJob({ stage: "RECEIVED", notifyCustomer: false });
    assert.equal(await stock(), 8);
  });

  it("deleting the job returns its stock", async () => {
    await addLine(3);
    assert.equal(await stock(), 7);
    const res = await jobRoute.DELETE(
      request("DELETE", `/api/jobs/${jobId}`, { host: S.host, as: S }),
      params(jobId)
    );
    assert.equal(res.status, 200);
    assert.equal(await stock(), 10);
  });

  it("lines sold before tracking return nothing when removed", async () => {
    const legacy = await prisma.jobProduct.create({
      data: { shopId: S.id, jobId, productId, quantity: 2, unitPrice: 8 },
    });
    await removeLine(legacy.id);
    assert.equal(await stock(), 10);
  });
});
