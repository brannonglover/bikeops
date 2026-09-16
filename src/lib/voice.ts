import { Platform } from "react-native";
import { Call, Voice } from "@twilio/voice-react-native-sdk";
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
