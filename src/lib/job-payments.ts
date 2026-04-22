type LineItem = {
  quantity?: number | null;
  unitPrice: unknown;
};

type DerivedPaymentStatus = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function parseMoney(value: unknown): number {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function computeLineItemsTotal(items: LineItem[] | null | undefined): number {
  const total = (items ?? []).reduce((sum, item) => {
    return sum + parseMoney(item.unitPrice) * (item.quantity || 1);
  }, 0);
  return roundCurrency(total);
}

export function computeJobSubtotal(input: {
  jobProducts?: LineItem[] | null;
  jobServices?: LineItem[] | null;
}): number {
  return roundCurrency(
    computeLineItemsTotal(input.jobServices) + computeLineItemsTotal(input.jobProducts)
  );
}

export function getJobPaymentSummary(input: {
  currentStatus?: string | null;
  subtotal: number;
  totalPaid: number;
}): {
  isPaidInFull: boolean;
  paymentStatus: DerivedPaymentStatus;
  remaining: number;
  subtotal: number;
  totalPaid: number;
} {
  const subtotal = roundCurrency(input.subtotal);
  const totalPaid = roundCurrency(input.totalPaid);
  const remainingCents = Math.max(0, toCents(subtotal) - toCents(totalPaid));
  const remaining = remainingCents / 100;
  const isPaidInFull = remainingCents === 0 && toCents(subtotal) > 0;

  let paymentStatus: DerivedPaymentStatus;
  if (isPaidInFull) {
    paymentStatus = "PAID";
  } else if (toCents(totalPaid) > 0) {
    paymentStatus = "PENDING";
  } else if (String(input.currentStatus ?? "").toUpperCase() === "REFUNDED") {
    paymentStatus = "REFUNDED";
  } else {
    paymentStatus = "UNPAID";
  }

  return {
    isPaidInFull,
    paymentStatus,
    remaining,
    subtotal,
    totalPaid,
  };
}
