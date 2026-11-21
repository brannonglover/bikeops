import "server-only";

import Twilio from "twilio";
import { prisma } from "@/lib/db";
import { ringStaffForCall, sendQueuedCallerToVoicemail } from "@/lib/voice";

/**
 * The hold-queue ring path: the caller is parked by <Enqueue> and staff are
 * alerted by a push repeated on every /wait pass. It now runs only for a shop
 * with `voiceNativeRingEnabled` off — the direct <Dial><Client> ring in
 * voice-ring.ts replaces it — and stays as the rollback until that path is
 * proven, after which this module goes.
 *
 * The leg helpers below belonged to the retired Design B, which rang each
 * device with its own REST-created Client call while still holding the caller
 * in the queue. Nothing creates CallLeg rows any more, so they are inert, but
 * /dequeued, /staff-answer and /staff-leg still reference them and they leave
 * with those routes.
 */

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? null;
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? null;

/** Leg states that mean a device could still be ringing. */
const LIVE_LEG_STATUSES = ["PENDING", "RINGING"] as const;

function twilioClient() {
  if (!accountSid || !authToken) throw new Error("Twilio is not configured");
  return Twilio(accountSid, authToken);
}

/**
 * A Twilio REST error that means "this leg is already gone". Cancelling a call
 * that has ended is the expected outcome of every race this module has, so it
 * is a success rather than something to retry or report.
 */
function isAlreadyGone(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const code = (error as { code?: number })?.code;
  // 404: no such call. 20009 / 21220: not in a state that can be cancelled.
  return status === 404 || code === 20404 || code === 20009 || code === 21220;
}

/**
 * Starts ringing staff for a caller who is about to be parked in the queue:
 * one notification now, repeated by /wait for as long as the caller holds.
 * Has to run before the <Enqueue> TwiML is returned, or the caller begins
 * holding before any device has been told.
 *
 * Never throws: a ring that fails must not take the call down — the caller
 * should still reach voicemail rather than hear an error.
 */
export async function ringStaffForHeldCaller(opts: {
  shopId: string;
  callSid: string;
}): Promise<void> {
  await ringStaffForCall(opts.shopId, opts.callSid).catch((error) => {
    console.error("[voice] staff push for incoming call failed:", error);
  });
}

/**
 * Stops every staff device still ringing for a call, optionally sparing the one
 * that just answered.
 *
 * The conditional update is the whole idempotency story. Only legs this call
 * actually moves into CANCELING are cancelled by it, so two settlement paths
 * racing each other — a staff answer and the caller hanging up in the same
 * instant — cannot both issue a REST cancel for the same leg, and a callback
 * Twilio retries cannot either.
 *
 * DECLINED legs are deliberately excluded rather than merely redundant.
 * Cancelling an invite a device has already rejected is what crashes the iOS
 * SDK (twilio-voice-react-native#722): the cancel arrives with no matching
 * invite, and the raise happens inside the PushKit delegate before its
 * completion handler, after which iOS throttles VoIP delivery to the app. The
 * patch in the mobile repo makes that survivable; not asking for it in the
 * first place is what makes it rare.
 */
export async function cancelStaffLegs(
  callId: string,
  opts: { exceptLegId?: string } = {}
): Promise<number> {
  const claimed = await prisma.callLeg.updateMany({
    where: {
      callId,
      status: { in: [...LIVE_LEG_STATUSES] },
      ...(opts.exceptLegId ? { id: { not: opts.exceptLegId } } : {}),
    },
    data: { status: "CANCELING" },
  });
  if (claimed.count === 0) return 0;

  // Legs without a callSid (Twilio never created the call) are already done —
  // nothing to REST-cancel, just mark them terminal.
  await prisma.callLeg.updateMany({
    where: { callId, status: "CANCELING", callSid: null },
    data: { status: "ENDED" },
  });

  const legs = await prisma.callLeg.findMany({
    where: { callId, status: "CANCELING", callSid: { not: null } },
    select: { id: true, callSid: true },
  });
  if (legs.length === 0) return 0;

  const client = twilioClient();
  await Promise.all(
    legs.map(async (leg) => {
      try {
        await client.calls(leg.callSid!).update({ status: "canceled" });
      } catch (error) {
        if (!isAlreadyGone(error)) {
          console.error("[voice] could not cancel staff leg", { legId: leg.id, error });
        }
      } finally {
        await prisma.callLeg
          .update({ where: { id: leg.id }, data: { status: "ENDED" } })
          .catch(() => {});
      }
    })
  );

  return legs.length;
}

/**
 * Claims a call for one staff leg. Resolves true for the leg that may bridge,
 * false for every other — including a second tap on the same device.
 */
export async function claimCallForLeg(callId: string, legId: string): Promise<boolean> {
  const claimed = await prisma.call.updateMany({
    where: { id: callId, claimedByLegId: null, answeredAt: null, endedAt: null },
    data: { claimedByLegId: legId },
  });
  return claimed.count === 1;
}

/**
 * Sends the caller to voicemail once the last device ringing for them has
 * declined.
 *
 * Declining is per-device on purpose: one mechanic putting their phone down
 * must not send the shop's customer to voicemail while a colleague is reaching
 * for theirs, which is how every multi-handset business line behaves. That only
 * holds while somebody is still being rung — so when the last live leg goes,
 * the caller stops holding for staff who have all said no.
 *
 * Nothing happens if the call was answered or has already ended; the claim and
 * the row's own terminal state are both checked in the update that closes it,
 * so a decline landing just after a colleague picked up is a no-op.
 */
export async function voicemailIfAllDeclined(opts: {
  callId: string;
  baseUrl: string;
}): Promise<boolean> {
  const { callId, baseUrl } = opts;

  const live = await prisma.callLeg.count({
    where: { callId, status: { in: [...LIVE_LEG_STATUSES] } },
  });
  if (live > 0) return false;

  const call = await prisma.call.findFirst({
    where: { id: callId, claimedByLegId: null, answeredAt: null, endedAt: null },
    select: { id: true, twilioParentCallSid: true },
  });
  if (!call) return false;

  // Claiming the row is what keeps two final declines from both redirecting the
  // caller and restarting a greeting that is already playing.
  const closed = await prisma.call.updateMany({
    where: { id: callId, claimedByLegId: null, answeredAt: null, endedAt: null },
    data: { status: "NO_ANSWER", endedAt: new Date() },
  });
  if (closed.count === 0) return false;

  await sendQueuedCallerToVoicemail(
    call.twilioParentCallSid,
    `${baseUrl}/api/webhooks/twilio/voice/voicemail`
  ).catch((error) => {
    // They may have hung up in the meantime, or /dequeued may have moved them
    // already. The row is closed either way.
    console.error("[voice] could not send an all-declined caller to voicemail:", error);
  });

  return true;
}
