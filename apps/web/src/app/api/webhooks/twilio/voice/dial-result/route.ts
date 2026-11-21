import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  authenticateVoiceWebhook,
  buildDialResultTwiml,
  getVoiceWebhookBaseUrl,
  unansweredCallerUrl,
} from "@/lib/voice";

export const runtime = "nodejs";

/** Caller-leg states in which the caller is still on the line. */
const CALLER_STILL_THERE = new Set(["queued", "ringing", "in-progress"]);

/**
 * <Dial action> for the direct staff ring (buildRingStaffTwiml) — requested
 * once the ring is over, with DialCallStatus saying how it ended.
 *
 * - completed: a device answered and the conversation is over. The row is
 *   closed here with the bridged duration; the caller's own leg completing
 *   reaches /status after this, finds the row closed and leaves it alone.
 * - anything else (no-answer, busy when every device declined, failed,
 *   canceled): nobody took it. A caller still on the line goes on to
 *   voicemail — or back to the AI assistant if it handed them over — which
 *   stamps its own terminal state. A caller who hung up during the ring is
 *   closed here as NO_ANSWER, since nothing else will say they were missed.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const dialCallStatus = params.DialCallStatus;

  const call = callSid
    ? await prisma.call.findUnique({
        where: {
          shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid },
        },
        select: { id: true, aiAnsweredAt: true },
      })
    : null;

  if (call) {
    const now = new Date();
    if (dialCallStatus === "completed") {
      const duration = params.DialCallDuration
        ? Number.parseInt(params.DialCallDuration, 10)
        : Number.NaN;
      await prisma.call
        .updateMany({
          where: { id: call.id, endedAt: null },
          data: {
            status: "COMPLETED",
            endedAt: now,
            ...(Number.isFinite(duration) ? { durationSeconds: duration } : {}),
          },
        })
        .catch((error) => {
          console.error("[voice] /dial-result could not close an answered call:", error);
        });
    } else if (!CALLER_STILL_THERE.has(params.CallStatus ?? "")) {
      await prisma.call
        .updateMany({
          where: { id: call.id, endedAt: null },
          data: { status: "NO_ANSWER", endedAt: now },
        })
        .catch((error) => {
          console.error("[voice] /dial-result could not close a missed call:", error);
        });
    }
  }

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildDialResultTwiml({
    dialCallStatus,
    unansweredUrl: unansweredCallerUrl(base, call),
  });

  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
