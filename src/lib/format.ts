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

export function jobTotal(
  services: { quantity: number; unitPrice: string }[],
  products: { quantity: number; unitPrice: string }[]
): number {
  let total = 0;
  for (const s of services) total += s.quantity * parseFloat(s.unitPrice);
  for (const p of products) total += p.quantity * parseFloat(p.unitPrice);
  return total;
}
