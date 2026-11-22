/**
 * A product alerts once when its stock drops to its low-stock level, and
 * again only after it has been restocked above it — against staging.
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
let lowStock: typeof import("@/lib/low-stock");
let productRoute: typeof import("@/app/api/products/[id]/route");

let S: TestShop;
let productId: string;

const setStock = (stockQuantity: number) =>
  prisma.product.update({ where: { id: productId }, data: { stockQuantity } });

const claimedIds = async () =>
  (await lowStock.claimLowStockAlerts(S.id, [productId])).map((p) => p.id);

const alertedAt = async () =>
  (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).lowStockAlertedAt;

describe("low-stock alerts", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    lowStock = await import("@/lib/low-stock");
    productRoute = await import("@/app/api/products/[id]/route");
    S = await createTestShop(prisma, `zzlowstock-${RUN}`);
  });

  beforeEach(async () => {
    const product = await prisma.product.create({
      data: { shopId: S.id, name: `Tube 700x25 ${RUN}`, price: 8, stockQuantity: 5, lowStockThreshold: 1 },
    });
    productId = product.id;
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: S?.id } });
    await prisma.$disconnect();
  });

  it("stays quiet above the threshold", async () => {
    await setStock(2);
    assert.deepEqual(await claimedIds(), []);
  });

  it("alerts once when stock reaches the threshold, not on every later sale", async () => {
    await setStock(1);
    assert.deepEqual(await claimedIds(), [productId]);
    assert.deepEqual(await claimedIds(), []);
    await setStock(0);
    assert.deepEqual(await claimedIds(), []);
  });

  it("re-arms after a restock above the threshold", async () => {
    await setStock(1);
    assert.deepEqual(await claimedIds(), [productId]);
    await setStock(6);
    assert.deepEqual(await claimedIds(), []);
    assert.equal(await alertedAt(), null);
    await setStock(1);
    assert.deepEqual(await claimedIds(), [productId]);
  });

  it("concurrent checks of the same dip alert once between them", async () => {
    await setStock(0);
    const results = await Promise.all([claimedIds(), claimedIds(), claimedIds()]);
    assert.equal(results.flat().length, 1);
  });

  it("products without a threshold never alert", async () => {
    await prisma.product.update({ where: { id: productId }, data: { lowStockThreshold: null, stockQuantity: 0 } });
    assert.deepEqual(await claimedIds(), []);
  });

  it("staff recounting to a low number marks it known instead of alerting later", async () => {
    const res = await productRoute.PATCH(
      request("PATCH", `/api/products/${productId}`, { host: S.host, as: S, body: { stockQuantity: 1 } }),
      { params: Promise.resolve({ id: productId }) }
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.notEqual(await alertedAt(), null);
    assert.deepEqual(await claimedIds(), []);
  });

  it("clearing the threshold re-arms it", async () => {
    await setStock(0);
    assert.deepEqual(await claimedIds(), [productId]);
    const res = await productRoute.PATCH(
      request("PATCH", `/api/products/${productId}`, { host: S.host, as: S, body: { lowStockThreshold: null } }),
      { params: Promise.resolve({ id: productId }) }
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(await alertedAt(), null);
  });
});
