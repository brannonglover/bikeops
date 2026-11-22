import { roundCurrency } from "@/lib/job-payments";

/** A product's price from what the shop pays and its markup. Safe to import in the browser. */
export function priceFromCost(cost: number, markupPercent: number): number {
  return roundCurrency(cost * (1 + Math.max(0, markupPercent) / 100));
}
