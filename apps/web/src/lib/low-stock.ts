import { prisma } from "@/lib/db";

/**
 * Low-stock alerts. A product with a `lowStockThreshold` alerts staff once
 * when its stock reaches that number or below, and re-arms once it is
 * restocked above it. `lowStockAlertedAt` marks the dip as already alerted.
 *
 * Both steps are conditional updates, so concurrent sales of the last few
 * units send one alert between them, not one each.
 */

export interface LowStockProduct {
  id: string;
  name: string;
  stockQuantity: number;
  lowStockThreshold: number | null;
  supplier: string | null;
}

/** True when the product is at or below the level staff asked to be alerted at. */
export function isLowStock(p: { stockQuantity: number; lowStockThreshold: number | null }): boolean {
  return p.lowStockThreshold != null && p.stockQuantity <= p.lowStockThreshold;
}

/**
 * Re-arms products that are back above their threshold (or no longer have
 * one), then claims every product that has newly dropped to it. Returns the
 * claimed products: the ones nobody has been alerted about yet.
 *
 * `productIds` limits both steps to those products; leave it out to check
 * the whole shop.
 */
export async function claimLowStockAlerts(
  shopId: string,
  productIds?: string[]
): Promise<LowStockProduct[]> {
  if (productIds && productIds.length === 0) return [];
  const scope = productIds ? { shopId, id: { in: productIds } } : { shopId };

  await prisma.product.updateMany({
    where: {
      ...scope,
      lowStockAlertedAt: { not: null },
      OR: [
        { lowStockThreshold: null },
        { stockQuantity: { gt: prisma.product.fields.lowStockThreshold } },
      ],
    },
    data: { lowStockAlertedAt: null },
  });

  return prisma.product.updateManyAndReturn({
    where: {
      ...scope,
      lowStockAlertedAt: null,
      lowStockThreshold: { not: null },
      stockQuantity: { lte: prisma.product.fields.lowStockThreshold },
    },
    data: { lowStockAlertedAt: new Date() },
    select: {
      id: true,
      name: true,
      stockQuantity: true,
      lowStockThreshold: true,
      supplier: true,
    },
  });
}

function leftLabel(qty: number): string {
  return qty <= 0 ? "out of stock" : `${qty} left`;
}

/** Push to every staff device and email the shop's notify address. */
async function sendLowStockAlert(shopId: string, products: LowStockProduct[]): Promise<void> {
  const [{ sendPushToAllStaff }, { sendLowStockNotification }] = await Promise.all([
    import("@/lib/push"),
    import("@/lib/email"),
  ]);

  const sorted = [...products].sort((a, b) => a.stockQuantity - b.stockQuantity);
  const first = sorted[0];
  const title =
    sorted.length === 1 ? `Low stock: ${first.name}` : `${sorted.length} products running low`;
  const body =
    sorted.length === 1
      ? `${leftLabel(first.stockQuantity)}. Time to reorder${first.supplier ? ` from ${first.supplier}` : ""}.`
      : sorted.map((p) => `${p.name} (${leftLabel(p.stockQuantity)})`).join(", ");

  await Promise.all([
    sendPushToAllStaff(shopId, {
      title,
      body,
      data: { type: "low_stock", productId: sorted.length === 1 ? first.id : undefined },
    }).catch((e) => console.error("[low-stock] push failed:", e)),
    sendLowStockNotification({ shopId, products: sorted })
      .then((r) => {
        if (!r.ok) console.warn("[low-stock] email not sent:", r.error);
      })
      .catch((e) => console.error("[low-stock] email failed:", e)),
  ]);
}

/**
 * Call after stock moves. With `notify`, staff hear about products that
 * just dropped to their threshold. Without it (staff edited the count or the
 * threshold themselves, so they already know), the dip is marked known and
 * nothing is sent. Never throws: a failed alert must not fail the sale.
 */
export async function syncLowStockAlerts(
  shopId: string,
  options: { productIds?: string[]; notify: boolean }
): Promise<void> {
  try {
    const claimed = await claimLowStockAlerts(shopId, options.productIds);
    if (options.notify && claimed.length > 0) await sendLowStockAlert(shopId, claimed);
  } catch (e) {
    console.error("[low-stock] check failed:", e);
  }
}
