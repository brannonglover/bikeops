export type BookingDigest = {
  todayJobIds: string[];
  tomorrowJobIds: string[];
};

let pending: BookingDigest | null = null;
const listeners = new Set<(digest: BookingDigest) => void>();

export function setPendingBookingDigest(digest: BookingDigest): void {
  pending = digest;
  listeners.forEach((listener) => listener(digest));
}

export function consumePendingBookingDigest(): BookingDigest | null {
  const digest = pending;
  pending = null;
  return digest;
}

export function subscribeBookingDigest(
  listener: (digest: BookingDigest) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parseJobIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (id): id is string => typeof id === "string" && id.length > 0
        );
      }
    } catch {
      // Comma-separated fallback for stringified push payloads.
    }
    return trimmed
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  }
  return [];
}
