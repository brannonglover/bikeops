import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { roundCurrency } from "@/lib/job-payments";
import { priceFromCost } from "@/lib/product-price";

export { priceFromCost };

/**
 * Product pricing: staff enter what a part costs the shop, and the price
 * customers pay is that cost plus a markup — the product's own %, else the
 * shop's. The price is stored on the product (re-worked whenever the cost or
 * a markup changes), so everything that sells products keeps reading `price`.
 *
 * A product with no cost was priced by hand before markup existed (or on
 * purpose) and keeps its price as entered; shop markup changes skip it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function getShopProductMarkup(shopId: string, db: Db = prisma): Promise<number> {
  const row = await db.appSettings.findUnique({ where: { shopId }, select: { productMarkupPercent: true } });
  return row ? Number(row.productMarkupPercent) : 0;
}

/**
 * The stored fields for a product being created or edited. Pass `cost` to
 * price from cost (null switches the product to a hand-set `price`), and
 * `markupPercent` to override the shop's (null: follow the shop's).
 */
export async function resolveProductPricing(
  shopId: string,
  input: {
    cost: number | null;
    markupPercent: number | null;
    /** Used only when cost is null. */
    price: number | null;
  },
  db: Db = prisma
): Promise<{ cost: number | null; markupPercent: number | null; price: number }> {
  if (input.cost === null) {
    if (input.price === null) throw new ProductPricingError("Enter a cost or a price.");
    return { cost: null, markupPercent: input.markupPercent, price: roundCurrency(input.price) };
  }
  const markup = input.markupPercent ?? (await getShopProductMarkup(shopId, db));
  return {
    cost: roundCurrency(input.cost),
    markupPercent: input.markupPercent,
    price: priceFromCost(input.cost, markup),
  };
}

export class ProductPricingError extends Error {}

/** Save the shop's markup and re-price every product that prices from cost and follows it. */
export async function updateShopProductMarkup(
  shopId: string,
  markupPercent: number
): Promise<{ markupPercent: number; productsRepriced: number }> {
  const pct = Math.round(markupPercent * 100) / 100;
  return prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { shopId },
      create: { shopId, productMarkupPercent: pct },
      update: { productMarkupPercent: pct },
    });
    // Postgres ROUND on numeric rounds half away from zero, matching
    // roundCurrency for the non-negative prices stored here.
    const repriced = await tx.$executeRaw`
      UPDATE "Product"
      SET "price" = ROUND("cost" * (1 + ${new Prisma.Decimal(pct)}::numeric / 100), 2),
          "updatedAt" = NOW()
      WHERE "shopId" = ${shopId}
        AND "cost" IS NOT NULL
        AND "markupPercent" IS NULL`;
    return { markupPercent: pct, productsRepriced: repriced };
  });
}
