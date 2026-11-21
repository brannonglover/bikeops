import "server-only";

import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/phone";
import { buildRingStaffTwiml, getStaffIdentitiesForShop } from "@/lib/voice";

/**
 * Whether this shop rings staff directly — <Dial><Client> per staff device —
 * rather than parking the caller in the hold queue and pushing a notification.
 *
 * Per shop, and the rollback is turning it off: the queue path is untouched.
 *
 * Turn it on only once every staff device runs a build that registers for
 * Twilio invites (registerForIncomingCalls in the mobile app). A device that
 * hasn't registered is simply not rung — the <Client> leg for it fails fast —
 * so a shop where no device has registered sends every caller to voicemail
 * after a ring nobody hears.
 */
export async function isDirectRingEnabled(shopId: string): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({
    where: { shopId },
    select: { voiceNativeRingEnabled: true },
  });
  return settings?.voiceNativeRingEnabled ?? false;
}

/**
 * The TwiML that rings every staff device for a waiting caller. See
 * buildRingStaffTwiml for what Twilio then does on its own; the routes that
 * matter afterwards are /status (a staff leg connecting stamps answeredAt) and
 * /dial-result (the ring ended — hang up, or on to voicemail).
 *
 * Null when the shop has no staff to ring: a <Dial> with no nouns is invalid
 * TwiML, so the caller takes the queue path instead and reaches voicemail.
 */
export async function ringStaffTwiml(opts: {
  shopId: string;
  callId: string;
  base: string;
  fromNumber: string;
  customerName: string | null;
}): Promise<string | null> {
  const { shopId, callId, base, fromNumber, customerName } = opts;
  const identities = await getStaffIdentitiesForShop(shopId);
  if (identities.length === 0) return null;
  return buildRingStaffTwiml({
    identities,
    callId,
    callerLabel: customerName?.trim() || formatPhoneDisplay(fromNumber) || "Unknown caller",
    actionUrl: `${base}/api/webhooks/twilio/voice/dial-result`,
    statusCallbackUrl: `${base}/api/webhooks/twilio/voice/status`,
  });
}
