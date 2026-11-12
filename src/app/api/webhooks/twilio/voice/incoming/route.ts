import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { normalizePhone } from "@/lib/phone";
import {
  authenticateVoiceWebhook,
  buildIncomingCallTwiml,
  buildQueueName,
  getVoiceWebhookBaseUrl,
} from "@/lib/voice";
import { ringStaffForHeldCaller } from "@/lib/voice-legs";
import { isDirectRingEnabled, ringStaffTwiml } from "@/lib/voice-ring";
import { connectCallToVoiceAgent, isAiVoiceAnswering } from "@/lib/ai/voice-agent";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio inbound Voice webhook — configure on the shop's Twilio number:
 * Voice → "A call comes in" → POST https://YOUR_SHOP.bikeops.co/api/webhooks/twilio/voice/incoming
 *
 * With the AI phone assistant on, the call is handed to it. Otherwise — or if
 * the assistant can't be reached — staff are rung. A shop with
 * `voiceNativeRingEnabled` rings every staff device directly with
 * <Dial><Client> (see ringStaffTwiml); any other shop parks the caller in the
 * hold queue and alerts staff with a repeated push, which answering dials
 * into.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const fromRaw = params.From;
  const toRaw = params.To;
  if (!callSid || !fromRaw || !toRaw) {
    return xmlResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be completed.</Say><Hangup/></Response>'
    );
  }

  const fromE164 = normalizePhone(fromRaw) ?? fromRaw;
  const toE164 = normalizePhone(toRaw) ?? toRaw;

  const customerId = await findCustomerIdBySmsFrom(shop.id, fromE164);
  const conversation = customerId
    ? await findOrCreateGeneralConversation(shop.id, customerId)
    : null;

  const call = await prisma.call.upsert({
    where: { shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid } },
    create: {
      shopId: shop.id,
      customerId,
      conversationId: conversation?.id ?? null,
      direction: "INBOUND",
      status: "RINGING",
      fromNumber: fromE164,
      toNumber: toE164,
      twilioParentCallSid: callSid,
      startedAt: new Date(),
    },
    update: {},
    select: {
      id: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  });

  const base = getVoiceWebhookBaseUrl(request);

  // The AI assistant picks up first when the shop has it on. Staff are only
  // rung if the caller asks for a person (see /ai-handoff), or right here if
  // the assistant can't be reached — a caller must never get dead air because
  // ElevenLabs was slow.
  if (await isAiVoiceAnswering(shop.id)) {
    const agentTwiml = await connectCallToVoiceAgent({
      shopId: shop.id,
      callId: call.id,
      customerId,
      base,
      fromNumber: fromE164,
      toNumber: toE164,
      mode: "answer",
    });
    if (agentTwiml) {
      await prisma.call
        .update({
          where: { id: call.id },
          data: { status: "IN_PROGRESS", aiAnsweredAt: new Date() },
        })
        .catch((error) => {
          // The call is answered either way; a missing stamp only costs the log.
          console.error("[voice] could not mark call as AI-answered:", error);
        });
      return xmlResponse(agentTwiml);
    }
  }

  const customerName = call.customer
    ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
    : null;

  // Direct ring: every staff device rings natively and the caller hears a
  // real ring until one answers. Twilio does the rest — see ringStaffTwiml.
  if (await isDirectRingEnabled(shop.id)) {
    const ring = await ringStaffTwiml({
      shopId: shop.id,
      callId: call.id,
      base,
      fromNumber: fromE164,
      customerName,
    });
    if (ring) return xmlResponse(ring);
  }

  // Queue path. Ringing has to start before the TwiML response, or the caller
  // begins holding before any device has been told to wake up.
  await ringStaffForHeldCaller({ shopId: shop.id, callSid });

  const twiml = buildIncomingCallTwiml({
    queueName: buildQueueName(shop.id),
    waitUrl: `${base}/api/webhooks/twilio/voice/wait`,
    actionUrl: `${base}/api/webhooks/twilio/voice/dequeued`,
  });

  return xmlResponse(twiml);
}
