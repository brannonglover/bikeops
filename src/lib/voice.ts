import { Platform } from "react-native";
import { Call, CallInvite, Voice } from "@twilio/voice-react-native-sdk";
import { getVoiceAccessToken } from "@/lib/api";

let voiceDevice: Voice | null = null;

function getVoiceDevice(): Voice {
  if (!voiceDevice) {
    voiceDevice = new Voice();
  }
  return voiceDevice;
}

function currentPlatform(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}

/**
 * Places an outbound call to a phone number via the shop's Twilio number.
 * The custom `To` param is read by the /outgoing TwiML webhook to dial the
 * PSTN leg — see bikeopsco's src/lib/voice.ts for the server-side half.
 */
export async function placeOutboundCall(
  toNumber: string,
  displayName?: string
): Promise<Call> {
  const { token } = await getVoiceAccessToken(currentPlatform());
  const voice = getVoiceDevice();
  return voice.connect(token, {
    params: { To: toNumber },
    contactHandle: displayName,
  });
}

/**
 * Registers this device's push token with Twilio so the /incoming webhook's
 * <Client> leg can actually ring it. Without this, inbound calls ring nothing
 * and fall through to voicemail after the <Dial> timeout.
 *
 * Requires a push credential on the server side (TWILIO_IOS_PUSH_CREDENTIAL_SID
 * / TWILIO_ANDROID_PUSH_CREDENTIAL_SID) — the access token carries it, and
 * without one Twilio has no way to wake a backgrounded app.
 */
/**
 * Stands up the SDK's own PushKit registry. Required on iOS because this app
 * has no native PushKit module of its own — without it no device token is
 * ever delivered and register() rejects with "Failed to initialize PushKit
 * device token" after its 3s wait. Safe to call repeatedly; no-op on Android.
 */
export async function initializePushRegistry(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await getVoiceDevice().initializePushRegistry();
}

export async function registerForIncomingCalls(): Promise<void> {
  const voice = getVoiceDevice();
  // Start the registry before minting the token: PushKit delivers the device
  // token asynchronously, and the token request's round trip gives it a head
  // start, so register() is less likely to hit its 3s timeout.
  await initializePushRegistry();
  const { token } = await getVoiceAccessToken(currentPlatform());
  await voice.register(token);
}

export async function unregisterForIncomingCalls(): Promise<void> {
  const { token } = await getVoiceAccessToken(currentPlatform());
  await getVoiceDevice().unregister(token);
}

/** Subscribes to inbound call invites. Returns an unsubscribe function. */
export function onCallInvite(listener: (invite: CallInvite) => void): () => void {
  const voice = getVoiceDevice();
  voice.on(Voice.Event.CallInvite, listener);
  return () => {
    voice.removeListener(Voice.Event.CallInvite, listener);
  };
}

/**
 * The caller's number as Twilio reports it on an invite. Client legs arrive
 * prefixed ("client:shop_x_staff_y"); PSTN callers arrive as E.164.
 */
export function callInviteFrom(invite: CallInvite): string {
  const from = invite.getFrom();
  return from.startsWith("client:") ? from.slice("client:".length) : from;
}
