import { Platform } from "react-native";
import { AudioDevice, Call, Voice } from "@twilio/voice-react-native-sdk";
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
 * The audio routes Twilio reports for the active call. Earpiece and speaker
 * always exist; bluetooth appears only while a headset is paired.
 */
export async function listAudioDevices(): Promise<{
  devices: AudioDevice[];
  selected: AudioDevice | null;
}> {
  const { audioDevices, selectedDevice } = await getVoiceDevice().getAudioDevices();
  return { devices: audioDevices, selected: selectedDevice ?? null };
}

/**
 * Routes call audio to the speaker or back to the earpiece. Resolves false
 * when the requested route isn't available (no bluetooth headset, say), so
 * callers can leave the toggle where it was instead of lying about the route.
 */
export async function selectAudioDevice(type: AudioDevice.Type): Promise<boolean> {
  const { devices } = await listAudioDevices();
  const match = devices.find((device) => device.type === type);
  if (!match) return false;
  await match.select();
  return true;
}

/** Subscribes to route changes (headset plugged in, etc.). Returns unsubscribe. */
export function onAudioDevicesUpdated(
  listener: (devices: AudioDevice[], selected?: AudioDevice) => void
): () => void {
  const voice = getVoiceDevice();
  voice.on(Voice.Event.AudioDevicesUpdated, listener);
  return () => {
    voice.removeListener(Voice.Event.AudioDevicesUpdated, listener);
  };
}

/**
 * Answers an inbound call announced by a push notification.
 *
 * Inbound calls are not Twilio invites here — they wait in the shop's queue
 * while an ordinary notification rings the device (this app deliberately does
 * not register for PushKit, because iOS would then force the call onto the
 * native CallKit screen). Answering therefore means placing an outbound leg
 * that dials into that queue, which /outgoing recognises by Mode=answer.
 */
export async function answerQueuedCall(
  callId: string,
  displayName?: string
): Promise<Call> {
  const { token } = await getVoiceAccessToken(currentPlatform());
  return getVoiceDevice().connect(token, {
    params: { Mode: "answer", CallId: callId },
    contactHandle: displayName,
  });
}
