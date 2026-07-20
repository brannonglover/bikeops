import type { Job, JobBike } from "@/lib/types";

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

export function customerName(customer: {
  firstName: string;
  lastName: string | null;
}): string {
  return customer.lastName
    ? `${customer.firstName} ${customer.lastName}`
    : customer.firstName;
}

export function jobBikeLabel(job: { bikeMake: string; bikeModel: string | null }): string {
  return formatMakeModel(job.bikeMake, job.bikeModel);
}

function isJobBikeUnlinkedFromProfile(jb: JobBike): boolean {
  return !jb.bikeId || !jb.bike;
}

function resolveJobBikeMakeModel(
  job: Job,
  jb: JobBike
): { make: string; model: string | null } {
  const customerBikes = job.customer?.bikes;
  if (customerBikes?.length === 1 && isJobBikeUnlinkedFromProfile(jb)) {
    return { make: customerBikes[0].make, model: customerBikes[0].model };
  }
  if (jb.bikeId && jb.bike) {
    return { make: jb.bike.make, model: jb.bike.model };
  }
  return { make: jb.make, model: jb.model };
}

function resolveLegacyJobMakeModel(job: Job): { make: string; model: string | null } {
  if (job.customer?.bikes?.length === 1) {
    const cb = job.customer.bikes[0];
    return { make: cb.make, model: cb.model };
  }
  return { make: job.bikeMake, model: job.bikeModel };
}

function formatMakeModel(make: string | null | undefined, model: string | null | undefined): string {
  const safeMake = (make ?? "").trim();
  const safeModel = (model ?? "").trim();
  const joined = [safeMake, safeModel].filter(Boolean).join(" ").trim();
  return joined || "Bike";
}

/**
 * Resolves the bike display title from the customer's live profile data when
 * available, so edits to a customer's bike are reflected on the board without
 * resyncing the denormalized bikeMake/bikeModel snapshot on the job.
 */
export function getJobBikeDisplayTitle(job: Job): string {
  const rows = [...(job.jobBikes ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  if (rows.length === 0) {
    if (job.bikeMake === "Multiple") {
      return `Multiple - ${job.bikeModel}`.trim();
    }
    const leg = resolveLegacyJobMakeModel(job);
    return formatMakeModel(leg.make, leg.model);
  }
  if (rows.length === 1) {
    const dp = resolveJobBikeMakeModel(job, rows[0]);
    return formatMakeModel(dp.make, dp.model);
  }
  return `Multiple - ${rows.length} bikes`;
}

/** First bike on the job by sort order (primary hero/card bike). */
export function getPrimaryJobBike(job: Job): JobBike | null {
  const bikes = [...(job.jobBikes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  return bikes[0] ?? null;
}

/**
 * Prefer the linked customer bike photo (what staff edit on the web), then the
 * jobBike snapshot. Falls back to a make/model match on the customer's bikes.
 */
export function getJobBikeImageUrl(
  jb: Pick<JobBike, "make" | "model" | "imageUrl" | "bike">,
  customerBikes?: { make: string; model: string | null; imageUrl: string | null }[] | null
): string | null {
  const url = jb.bike?.imageUrl ?? jb.imageUrl ?? null;
  if (url) return url;
  if (!customerBikes?.length) return null;
  const makeNorm = (jb.make ?? "").trim().toLowerCase();
  const modelNorm = (jb.model ?? "").trim().toLowerCase();
  if (!makeNorm || !modelNorm) return null;
  const match = customerBikes.find(
    (cb) =>
      (cb.make ?? "").trim().toLowerCase() === makeNorm &&
      (cb.model ?? "").trim().toLowerCase() === modelNorm
  );
  return match?.imageUrl ?? null;
}

export function formatPhoneNumber(raw: string): string {
  const normalizedDigits = raw.replace(/\D/g, "");
  const digits =
    normalizedDigits.length === 11 && normalizedDigits.startsWith("1")
      ? normalizedDigits.slice(1)
      : normalizedDigits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function unformatPhoneNumber(formatted: string): string {
  return formatted.replace(/\D/g, "");
}

export function jobTotal(
  services: ({ quantity?: number | null; unitPrice?: string | null } | null | undefined)[] | null | undefined,
  products: ({ quantity?: number | null; unitPrice?: string | null } | null | undefined)[] | null | undefined
): number {
  let total = 0;
  for (const s of services ?? []) {
    if (!s) continue;
    const quantity = Number(s.quantity ?? 0);
    const unitPrice = Number.parseFloat(s.unitPrice ?? "0");
    if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      total += quantity * unitPrice;
    }
  }
  for (const p of products ?? []) {
    if (!p) continue;
    const quantity = Number(p.quantity ?? 0);
    const unitPrice = Number.parseFloat(p.unitPrice ?? "0");
    if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      total += quantity * unitPrice;
    }
  }
  return total;
}
