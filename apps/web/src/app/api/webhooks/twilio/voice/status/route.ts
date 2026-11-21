import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startAssistantCallOutreach } from "@/lib/ai/call-outreach";
import {
  authenticateVoiceWebhook,
  isInbandRingbackCallback,
  mapTwilioCallStatus,
  tellAppCustomerAnswered,
} from "@/lib/voice";

export const runtime = "nodejs";

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "BUSY",
  "FAILED",
  "NO_ANSWER",
  "CANCELED",
  "VOICEMAIL",
]);

/**
 * Shared status callback for both call legs. Twilio sends this both for the
 * parent leg (set as the number's/TwiML App's console-level Status Callback)
 * and for the child leg created by <Dial> (set via the statusCallback
 * attribute in voice.ts's TwiML builders) — disambiguated below by whether
 * ParentCallSid is present, per the call-leg correlation design.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const parentCallSid = params.ParentCallSid || null;
  const status = mapTwilioCallStatus(params.CallStatus);
  if (!callSid || !status) {
    return new NextResponse("ok", { status: 200 });
  }

  // The customer picking up on a call dialed with in-call ringback. Started
  // before the Call row is touched, and awaited only at the end, because the
  // app is holding "Calling…" over a live conversation until it lands.
  const answeredNotice =
    parentCallSid && status === "IN_PROGRESS" && isInbandRingbackCallback(request)
      ? tellAppCustomerAnswered(parentCallSid).catch((error) => {
          console.error("[voice] could not tell the app the customer answered:", error);
        })
      : null;

  const call = await prisma.call.findFirst({
    where: parentCallSid
      ? { shopId: shop.id, twilioParentCallSid: parentCallSid }
      : { shopId: shop.id, twilioParentCallSid: callSid },
  });
  if (!call) {
    console.warn("Twilio Voice /status: no matching Call", { callSid, parentCallSid });
    await answeredNotice;
    return new NextResponse("ok", { status: 200 });
  }

  // A staff leg of an inbound direct ring (buildRingStaffTwiml). One inbound
  // call has a leg per staff device, and every one but the winner ends as
  // canceled, busy or no-answer — so none of those may close the row the way a
  // single outbound <Number> leg's would. The only thing a staff leg says
  // about the call is that it connected: that is the answer, and that leg is
  // the child worth keeping. The caller's own leg and /dial-result close it.
  if (parentCallSid && call.direction === "INBOUND") {
    if (status === "IN_PROGRESS") {
      await prisma.call.updateMany({
        where: { id: call.id, answeredAt: null, endedAt: null },
        data: { status: "IN_PROGRESS", answeredAt: new Date(), twilioChildCallSid: callSid },
      });
    }
    return new NextResponse("ok", { status: 200 });
  }

  // Already reached a terminal state — don't let a stray late callback (e.g.
  // the parent leg's own "completed" arriving after the child leg's) regress
  // duration/timestamps. Only the write is skipped, not the outreach check
  // below: this callback is the one every call gets, and another route having
  // closed the row first is routine rather than stray. /dequeued closes a
  // caller who hung up on hold before this ever arrives, which is exactly how
  // that caller used to go untexted.
  const alreadyClosed = TERMINAL_STATUSES.has(call.status) && call.endedAt !== null;

  if (!alreadyClosed) {
    const now = new Date();
    const durationSeconds = params.CallDuration ? parseInt(params.CallDuration, 10) : undefined;

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        twilioChildCallSid:
          parentCallSid && !call.twilioChildCallSid ? callSid : call.twilioChildCallSid,
        startedAt: call.startedAt ?? now,
        // Only a bridged child leg reaching in-progress means a human picked
        // up. An inbound caller's own leg goes in-progress the instant Twilio
        // answers it to run <Enqueue>, which is not an answer at all — that
        // signal comes from /answered instead. Stamping it here would log every
        // voicemail as a taken call.
        answeredAt:
          status === "IN_PROGRESS" && parentCallSid
            ? (call.answeredAt ?? now)
            : call.answeredAt,
        endedAt: TERMINAL_STATUSES.has(status) ? now : call.endedAt,
        durationSeconds:
          TERMINAL_STATUSES.has(status) && durationSeconds !== undefined
            ? durationSeconds
            : call.durationSeconds,
      },
    });
  }

  // A caller who rang off before voicemail leaves no recording and no
  // transcript, so this callback is the only place the AI assistant can learn
  // they tried. Calls that reached voicemail are handled from the recording
  // and transcription callbacks instead, which know what was said.
  // mapTwilioCallStatus never returns VOICEMAIL — that status is written by
  // the voicemail route itself, so the stored one is what rules it out here.
  const wentUnanswered =
    TERMINAL_STATUSES.has(status) &&
    call.status !== "VOICEMAIL" &&
    !call.answeredAt &&
    !call.recordingSid;
  if (wentUnanswered) {
    await startAssistantCallOutreach({
      shopId: shop.id,
      callId: call.id,
      trigger: "missed_call",
    });
  }

  await answeredNotice;
  return new NextResponse("ok", { status: 200 });
}
