type LineItem = {
  quantity?: number | null;
  unitPrice: unknown;
};

type PaymentRecord = {
  amount: unknown;
  paymentMethod?: string | null;
  status: unknown;
  stripePaymentIntentId?: string | null;
};

type DerivedPaymentStatus = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";

const DEFAULT_SURCHARGE_PERCENT = 2.9;
const DEFAULT_SURCHARGE_FIXED_CENTS = 30;

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function getCardSurchargeConfig(): { fixed: number; pct: number } {
  const percent = Number(process.env.CARD_SURCHARGE_PERCENT);
  const fixedCents = Number(process.env.CARD_SURCHARGE_FIXED_CENTS);
  const useDefaults =
    Number.isNaN(percent) || process.env.CARD_SURCHARGE_PERCENT === undefined;
  const pct = useDefaults ? DEFAULT_SURCHARGE_PERCENT : percent;
  const fixed = Number.isNaN(fixedCents)
    ? DEFAULT_SURCHARGE_FIXED_CENTS / 100
    : fixedCents / 100;
  return { pct, fixed };
}

function computeTotalFromChargedAmount(
  amountCharged: number,
  mode: "online" | "in_person" | "terminal"
): number {
  if (mode === "terminal") return amountCharged;
  const { pct, fixed } = getCardSurchargeConfig();
  if (pct === 0 && fixed === 0) return amountCharged;
  const total = amountCharged - (amountCharged * (pct / 100) + fixed);
  return roundCurrency(total);
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

/**
 * A job's tax and discount settings. Every key is required so a server query
 * that forgets to select one fails to compile rather than silently billing
 * without tax; values may be null/undefined (treated as "none").
 */
export type JobPricing = {
  taxRatePercent: unknown;
  taxServices: boolean | null | undefined;
  taxProducts: boolean | null | undefined;
  taxExempt: boolean | null | undefined;
  discountType: "AMOUNT" | "PERCENT" | string | null | undefined;
  discountValue: unknown;
};

export type JobTotalsInput = JobPricing & {
  jobServices?: LineItem[] | null;
  jobProducts?: LineItem[] | null;
};

export type JobTotals = {
  servicesTotal: number;
  productsTotal: number;
  /** Sum of every line, before discount and tax. */
  itemsTotal: number;
  discount: number;
  /** Discounted amount the tax is charged on. */
  taxableAmount: number;
  taxRatePercent: number;
  tax: number;
  /** What the customer owes in all: items − discount + tax. */
  total: number;
};

/**
 * The one place a job's bill is worked out. The discount comes off first and
 * is spread over taxed and untaxed lines in proportion, so a discount never
 * makes the tax larger than it would be on the taxed lines alone.
 */
export function computeJobTotals(input: JobTotalsInput): JobTotals {
  const servicesTotal = computeLineItemsTotal(input.jobServices);
  const productsTotal = computeLineItemsTotal(input.jobProducts);
  const itemsTotal = roundCurrency(servicesTotal + productsTotal);

  const discountValue = Math.max(0, parseMoney(input.discountValue));
  let discount = 0;
  if (input.discountType === "AMOUNT") discount = discountValue;
  else if (input.discountType === "PERCENT") discount = (itemsTotal * Math.min(discountValue, 100)) / 100;
  discount = roundCurrency(Math.min(Math.max(0, discount), itemsTotal));

  const rate = input.taxExempt ? 0 : Math.max(0, parseMoney(input.taxRatePercent));
  const taxedLines =
    (input.taxServices ? servicesTotal : 0) + (input.taxProducts ? productsTotal : 0);
  const taxableAmount =
    itemsTotal > 0 && rate > 0
      ? roundCurrency(taxedLines - discount * (taxedLines / itemsTotal))
      : 0;
  const tax = roundCurrency(Math.max(0, (taxableAmount * rate) / 100));

  return {
    servicesTotal,
    productsTotal,
    itemsTotal,
    discount,
    taxableAmount,
    taxRatePercent: rate,
    tax,
    total: roundCurrency(itemsTotal - discount + tax),
  };
}

/** What the customer owes in all (items − discount + tax). */
export function computeJobTotal(input: JobTotalsInput): number {
  return computeJobTotals(input).total;
}

export function computeTotalPaid(
  payments: PaymentRecord[] | null | undefined
): number {
  const totalPaid = (payments ?? []).reduce((sum, payment) => {
    const status = String(payment.status ?? "").toLowerCase();
    if (status !== "succeeded") return sum;

    const amount = Number.parseFloat(String(payment.amount));
    if (!Number.isFinite(amount)) return sum;

    const method = String(payment.paymentMethod ?? "").toLowerCase();

    if (method === "refund") {
      return sum + amount;
    }

    const isStripe = Boolean(payment.stripePaymentIntentId);
    const mode =
      method === "terminal" || method === "card_present" ? "terminal" : "online";

    const amountTowardJobTotal = isStripe
      ? computeTotalFromChargedAmount(amount, mode)
      : amount;

    return sum + amountTowardJobTotal;
  }, 0);

  return roundCurrency(Math.max(0, totalPaid));
}

export function computeTotalRefunded(
  payments: PaymentRecord[] | null | undefined
): number {
  const totalRefunded = (payments ?? []).reduce((sum, payment) => {
    const status = String(payment.status ?? "").toLowerCase();
    if (status !== "succeeded") return sum;
    const method = String(payment.paymentMethod ?? "").toLowerCase();
    if (method !== "refund") return sum;
    const amount = Number.parseFloat(String(payment.amount));
    if (!Number.isFinite(amount)) return sum;
    return sum + Math.abs(amount);
  }, 0);
  return roundCurrency(totalRefunded);
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
  const currentStatus = String(input.currentStatus ?? "").toUpperCase();
  const rawRemainingCents = Math.max(0, toCents(subtotal) - toCents(totalPaid));
  const remainingCents = rawRemainingCents <= 1 && toCents(totalPaid) > 0
    ? 0
    : rawRemainingCents;
  const remaining = remainingCents / 100;
  const isPaidInFull = remainingCents === 0 && toCents(subtotal) > 0;

  let paymentStatus: DerivedPaymentStatus;
  if (currentStatus === "REFUNDED") {
    paymentStatus = "REFUNDED";
  } else if (isPaidInFull) {
    paymentStatus = "PAID";
  } else if (toCents(totalPaid) > 0) {
    paymentStatus = "PENDING";
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

/** Copy a job row's tax and discount fields (e.g. into an email payload). */
export function pickJobPricing<T extends JobPricing & { discountReason?: string | null }>(
  job: T
): JobPricing & { discountReason: string | null } {
  return {
    taxRatePercent: job.taxRatePercent,
    taxServices: job.taxServices,
    taxProducts: job.taxProducts,
    taxExempt: job.taxExempt,
    discountType: job.discountType,
    discountValue: job.discountValue,
    discountReason: job.discountReason ?? null,
  };
}

/**
 * computeJobTotals for a job received as JSON from the API, where pricing
 * fields may be absent (an older response) and count as "no tax, no discount".
 * Server code should call computeJobTotals so missing fields fail to compile.
 */
export function computeJobTotalsFromApi(job: Partial<JobPricing> & {
  jobServices?: LineItem[] | null;
  jobProducts?: LineItem[] | null;
}): JobTotals {
  return computeJobTotals({
    jobServices: job.jobServices,
    jobProducts: job.jobProducts,
    taxRatePercent: job.taxRatePercent,
    taxServices: job.taxServices,
    taxProducts: job.taxProducts,
    taxExempt: job.taxExempt,
    discountType: job.discountType,
    discountValue: job.discountValue,
  });
}
