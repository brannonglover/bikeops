/**
 * Product markup: customers pay cost + markup, a shop markup change re-prices
 * only the products that follow it, and hand-priced products and job lines
 * already sold never move — through the real route handlers, against staging.
 *
 *   npm run test:markup:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let productsRoute: typeof import("@/app/api/products/route");
let productRoute: typeof import("@/app/api/products/[id]/route");
let markupRoute: typeof import("@/app/api/settings/product-markup/route");

let S: TestShop;

type ProductJson = { id: string; price: string; cost: string | null; markupPercent: string | null };

async function create(body: Record<string, unknown>): Promise<ProductJson> {
  const res = await productsRoute.POST(
    request("POST", "/api/products", { host: S.host, as: S, body: { name: `Part ${RUN}`, ...body } })
  );
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as ProductJson;
}

async function patch(id: string, body: Record<string, unknown>): Promise<ProductJson> {
  const res = await productRoute.PATCH(
    request("PATCH", `/api/products/${id}`, { host: S.host, as: S, body }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as ProductJson;
}

async function setShopMarkup(markupPercent: number) {
  const res = await markupRoute.PUT(
    request("PUT", "/api/settings/product-markup", { host: S.host, as: S, body: { markupPercent } })
  );
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as { productsRepriced: number };
}

const price = async (id: string) => Number((await prisma.product.findUniqueOrThrow({ where: { id } })).price);

describe("product markup", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    ({ prisma } = await import("@/lib/db"));
    productsRoute = await import("@/app/api/products/route");
    productRoute = await import("@/app/api/products/[id]/route");
    markupRoute = await import("@/app/api/settings/product-markup/route");
    S = await createTestShop(prisma, `zzmarkup-${RUN}`);
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: S?.id } });
    await prisma.$disconnect();
  });

  it("prices from cost with the shop markup or a product's own", async () => {
    await setShopMarkup(30);
    const shopDefault = await create({ cost: 10 });
    assert.equal(Number(shopDefault.price), 13);
    assert.equal(shopDefault.markupPercent, null);
    const own = await create({ cost: 10, markupPercent: 50 });
    assert.equal(Number(own.price), 15);
    const rounded = await create({ cost: 19.99 });
    assert.equal(Number(rounded.price), 25.99, "19.99 × 1.30 = 25.987 → 25.99");
  });

  it("a price sent without cost is charged as entered, as before", async () => {
    const legacy = await create({ price: 42 });
    assert.equal(Number(legacy.price), 42);
    assert.equal(legacy.cost, null);
  });

  it("a shop markup change re-prices only products that follow it", async () => {
    await setShopMarkup(30);
    const follows = await create({ cost: 10 });
    const own = await create({ cost: 10, markupPercent: 50 });
    const byHand = await create({ price: 42 });
    const job = await prisma.job.create({
      data: { shopId: S.id, bikeMake: "Trek", bikeModel: "FX", stage: "WORKING_ON" },
    });
    const line = await prisma.jobProduct.create({
      data: { shopId: S.id, jobId: job.id, productId: follows.id, quantity: 1, unitPrice: follows.price },
    });

    const { productsRepriced } = await setShopMarkup(40);
    assert.ok(productsRepriced >= 1);
    assert.equal(await price(follows.id), 14);
    assert.equal(await price(own.id), 15, "own markup is untouched");
    assert.equal(await price(byHand.id), 42, "hand-set price is untouched");
    const sold = await prisma.jobProduct.findUniqueOrThrow({ where: { id: line.id } });
    assert.equal(Number(sold.unitPrice), 13, "a line already on a job keeps the price it was added at");
  });

  it("edits switch between own markup, shop markup and a hand-set price", async () => {
    await setShopMarkup(20);
    const p = await create({ cost: 50, markupPercent: 10 });
    assert.equal(Number(p.price), 55);

    const followsShop = await patch(p.id, { markupPercent: null });
    assert.equal(Number(followsShop.price), 60);

    const newCost = await patch(p.id, { cost: 100 });
    assert.equal(Number(newCost.price), 120);

    const byHand = await patch(p.id, { price: 99 });
    assert.equal(Number(byHand.price), 99);
    assert.equal(byHand.cost, null);

    const stockOnly = await patch(p.id, { stockQuantity: 5 });
    assert.equal(Number(stockOnly.price), 99, "editing other fields leaves the price alone");

    const backToCost = await patch(p.id, { cost: 10 });
    assert.equal(Number(backToCost.price), 12);
  });

  it("an existing hand-priced product keeps its price until given a cost", async () => {
    const old = await prisma.product.create({ data: { shopId: S.id, name: `Old ${RUN}`, price: 30 } });
    await setShopMarkup(50);
    assert.equal(await price(old.id), 30);
    const renamed = await patch(old.id, { name: `Old renamed ${RUN}` });
    assert.equal(Number(renamed.price), 30);
  });
});
