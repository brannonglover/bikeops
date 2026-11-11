import type { Prisma } from "@prisma/client";

/**
 * Product stock follows the job lines that sell it. Each JobProduct records in
 * `stockDeductedQty` how many units it has taken off the shelf, so returning
 * stock gives back exactly what was taken — never more. Lines added before
 * tracking began hold 0 and return nothing.
 *
 * Stock may go negative: a sale is never blocked by an out-of-date count, and a
 * negative number tells the shop to recount.
 *
 * Every write here is a conditional update on the line, so a retried or
 * concurrent request cannot move the same units twice.
 */

type Tx = Prisma.TransactionClient;

/** Take `quantity` units for a line that currently holds none (a new line on a live job). */
export async function takeStockForLine(
  tx: Tx,
  line: { id: string; productId: string; quantity: number }
): Promise<void> {
  if (line.quantity <= 0) return;
  const claimed = await tx.jobProduct.updateMany({
    where: { id: line.id, stockDeductedQty: 0 },
    data: { stockDeductedQty: line.quantity },
  });
  if (claimed.count === 0) return;
  await tx.product.update({
    where: { id: line.productId },
    data: { stockQuantity: { decrement: line.quantity } },
  });
}

/** Return everything a line holds to the shelf (the line is being removed). */
export async function releaseStockForLine(
  tx: Tx,
  line: { id: string; productId: string; stockDeductedQty: number }
): Promise<void> {
  if (line.stockDeductedQty <= 0) return;
  const released = await tx.jobProduct.updateMany({
    where: { id: line.id, stockDeductedQty: line.stockDeductedQty },
    data: { stockDeductedQty: 0 },
  });
  if (released.count === 0) return;
  await tx.product.update({
    where: { id: line.productId },
    data: { stockQuantity: { increment: line.stockDeductedQty } },
  });
}

/**
 * A line's quantity changed on a live job: take more for an increase, return
 * up to what the line holds for a decrease.
 */
export async function adjustStockForQuantityChange(
  tx: Tx,
  line: { id: string; productId: string; quantity: number; stockDeductedQty: number },
  nextQuantity: number
): Promise<void> {
  const delta = nextQuantity - line.quantity;
  if (delta === 0) return;
  const nextHeld =
    delta > 0
      ? line.stockDeductedQty + delta
      : Math.max(0, line.stockDeductedQty + delta);
  const moved = nextHeld - line.stockDeductedQty;
  if (moved === 0) return;
  const updated = await tx.jobProduct.updateMany({
    where: { id: line.id, stockDeductedQty: line.stockDeductedQty },
    data: { stockDeductedQty: nextHeld },
  });
  if (updated.count === 0) return;
  await tx.product.update({
    where: { id: line.productId },
    data: { stockQuantity: { decrement: moved } },
  });
}

/** Job is cancelled or about to be deleted: every line returns its units. */
export async function releaseStockForJob(tx: Tx, jobId: string): Promise<void> {
  const lines = await tx.jobProduct.findMany({
    where: { jobId, stockDeductedQty: { gt: 0 } },
    select: { id: true, productId: true, stockDeductedQty: true },
  });
  for (const line of lines) await releaseStockForLine(tx, line);
}

/** Job is restored from cancelled: its lines are sold again. */
export async function takeStockForJob(tx: Tx, jobId: string): Promise<void> {
  const lines = await tx.jobProduct.findMany({
    where: { jobId, stockDeductedQty: 0 },
    select: { id: true, productId: true, quantity: true },
  });
  for (const line of lines) await takeStockForLine(tx, line);
}
