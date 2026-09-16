import type { Call } from "@/lib/types";
import { customerName, formatPhoneNumber } from "@/lib/format";

export type CallOutcome = "taken" | "missed" | "outgoing" | "in-progress";

/**
 * How a call should read in the log. `answeredAt` is the source of truth for
 * "taken" — an inbound call that rang every staff device and timed out to
 * voicemail never gets one, which is exactly the missed case.
 */
export function callOutcome(call: Call): CallOutcome {
  if (call.status === "RINGING" || call.status === "QUEUED" || call.status === "IN_PROGRESS") {
    return "in-progress";
  }
  if (call.direction === "OUTBOUND") return "outgoing";
  return call.answeredAt ? "taken" : "missed";
}

/** The other party's number — who called us, or who we called. */
export function counterpartyNumber(call: Call): string {
  return call.direction === "INBOUND" ? call.fromNumber : call.toNumber;
}

/** Customer name when known, otherwise the formatted raw number. */
export function callDisplayName(call: Call): string {
  if (call.customer) return customerName(call.customer);
  return formatPhoneNumber(counterpartyNumber(call));
}

/** Callers with no customer record yet — the "new customer" case. */
export function isUnknownCaller(call: Call): boolean {
  return call.customer === null;
}

export function formatCallDuration(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
