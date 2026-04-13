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

export function jobBikeLabel(job: { bikeMake: string; bikeModel: string }): string {
  return `${job.bikeMake} ${job.bikeModel}`;
}

function isJobBikeUnlinkedFromProfile(jb: JobBike): boolean {
  return !jb.bikeId || !jb.bike;
}

function resolveJobBikeMakeModel(
  job: Job,
  jb: JobBike
): { make: string; model: string } {
  const customerBikes = job.customer?.bikes;
  if (customerBikes?.length === 1 && isJobBikeUnlinkedFromProfile(jb)) {
    return { make: customerBikes[0].make, model: customerBikes[0].model };
  }
  if (jb.bikeId && jb.bike) {
    return { make: jb.bike.make, model: jb.bike.model };
  }
  return { make: jb.make, model: jb.model };
}

function resolveLegacyJobMakeModel(job: Job): { make: string; model: string } {
  if (job.customer?.bikes?.length === 1) {
    const cb = job.customer.bikes[0];
    return { make: cb.make, model: cb.model };
  }
  return { make: job.bikeMake, model: job.bikeModel };
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
    if (job.bikeMake === "Multiple") return job.bikeModel;
    const leg = resolveLegacyJobMakeModel(job);
    return `${leg.make} ${leg.model}`.trim();
  }
  if (rows.length === 1) {
    const dp = resolveJobBikeMakeModel(job, rows[0]);
    return `${dp.make} ${dp.model}`.trim();
  }
  if (job.bikeMake === "Multiple") return job.bikeModel;
  return `${job.bikeMake} ${job.bikeModel}`.trim();
}

export function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function unformatPhoneNumber(formatted: string): string {
  return formatted.replace(/\D/g, "");
}

export function jobTotal(
  services: { quantity: number; unitPrice: string }[],
  products: { quantity: number; unitPrice: string }[]
): number {
  let total = 0;
  for (const s of services) total += s.quantity * parseFloat(s.unitPrice);
  for (const p of products) total += p.quantity * parseFloat(p.unitPrice);
  return total;
}
