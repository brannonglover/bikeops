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

/**
 * A missed call worth opening. `hasRecording` alone isn't enough — the row
 * arrives with the flag set before Twilio finishes processing, and a player
 * pointed at an unprocessed recording just fails.
 */
export function hasVoicemail(call: Call): boolean {
  return call.hasRecording && call.recordingStatus === "completed";
}

export type VoicemailTranscript =
  | { state: "none" }
  | { state: "pending" }
  | { state: "failed" }
  | { state: "ready"; text: string };

/**
 * Transcript state for display. Kept as a union rather than a nullable string
 * so the panel can say "Transcribing…" and "Transcript unavailable" instead of
 * collapsing both into an empty space.
 */
export function voicemailTranscript(call: Call): VoicemailTranscript {
  const text = call.transcriptionText?.trim();
  if (text) return { state: "ready", text };
  if (call.transcriptionStatus === "in-progress") return { state: "pending" };
  if (call.transcriptionStatus === "failed") return { state: "failed" };
  // "completed" with no text means the caller left silence.
  if (call.transcriptionStatus === "completed") return { state: "failed" };
  return { state: "none" };
}

/** Elapsed/total readout for the voicemail scrubber, e.g. "0:07 / 0:24". */
export function formatPlaybackTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
