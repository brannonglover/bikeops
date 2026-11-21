import { Platform } from "react-native";
import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";
import { api } from "@/lib/api";

/**
 * Twilio's <Play> accepts mp3, wav, aiff, gsm and ulaw — not the m4a/AAC that
 * both platforms record by default. iOS can write LINEARPCM (wav) natively, so
 * the greeting is captured in a format Twilio can use without transcoding.
 *
 * Android's recorder offers no wav or mp3 container (only 3gp, mpeg4, amrnb,
 * amrwb, aac_adts, mpeg2ts and webm), so recording a greeting there needs
 * server-side conversion that doesn't exist yet — see `canRecordGreeting`.
 */
export const GREETING_RECORDING_OPTIONS: RecordingOptions = {
  extension: ".wav",
  // Phone calls are 8kHz; capturing at 16k and letting Twilio downsample
  // avoids the aliasing a direct 8k capture picks up, at a trivial size cost.
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000,
  },
};

/** Whether this platform can produce a greeting Twilio is able to play. */
export const canRecordGreeting = Platform.OS === "ios";

/** Keeps a caller from sitting through a greeting that runs long. */
export const MAX_GREETING_SECONDS = 60;

/** Below this a "recording" is almost certainly a mis-tap, not a greeting. */
export const MIN_GREETING_SECONDS = 1;

export async function fetchVoicemailGreeting(): Promise<string | null> {
  const { data } = await api.get<{ url: string | null }>("/api/voice/greeting");
  return data.url;
}

export async function uploadVoicemailGreeting(fileUri: string): Promise<string> {
  const formData = new FormData();
  // React Native's FormData takes this shape rather than a File; the cast is
  // what every upload in this app does.
  formData.append("file", {
    uri: fileUri,
    name: "greeting.wav",
    type: "audio/wav",
  } as unknown as Blob);

  const { data } = await api.postForm<{ url: string }>("/api/voice/greeting", formData);
  return data.url;
}

export async function deleteVoicemailGreeting(): Promise<void> {
  await api.delete("/api/voice/greeting");
}

/** mm:ss for the recorder's live timer. */
export function formatGreetingClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
