import { Platform } from "react-native";
import {
  AudioDevice,
  Call,
  CallInvite,
  CallKit,
  Voice,
} from "@twilio/voice-react-native-sdk";
import { getVoiceAccessToken } from "@/lib/api";
import { INCOMING_CALL_SOUND } from "@/lib/notifications";

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
 * Stands up the SDK's PushKit registry at launch.
 *
 * This is what receives the VoIP push Twilio sends when the server dials this
 * device as a <Client>, and it has to be in place before any call — inbound or
 * out. Without it the SDK's CallKit path cannot start calls at all: every
 * connect() hung with nothing ever reaching Twilio.
 */
export async function initializePushRegistry(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await getVoiceDevice().initializePushRegistry();
}

/**
 * Dresses the system call screen as this app's.
 *
 * The screen itself belongs to iOS and cannot be replaced — any VoIP push has
 * to be handed straight to CallKit — but the ringtone and the icon on it are
 * ours, which is what makes an incoming call read as the shop's rather than as
 * a generic call. The ringtone is the same file the app bundles for
 * notifications; the expo-notifications config plugin copies it into the iOS
 * bundle, which is where CallKit looks for it by name.
 */
export async function configureCallKit(): Promise<void> {
  if (Platform.OS !== "ios") return;
  // Every one of these is optional on the native side — it only reads the keys
  // that are present — even though the SDK's type marks them all required, so
  // this sets the two that matter and leaves the rest at the SDK's defaults
  // (which are already one call group of one call). An icon on the call screen
  // would need an 80x80 PNG added to the iOS bundle; nothing ships one yet.
  const configuration = {
    callKitRingtoneSound: INCOMING_CALL_SOUND,
    callKitIncludesCallsInRecents: true,
  } as CallKit.ConfigurationOptions;

  await getVoiceDevice().setCallKitConfiguration(configuration);
}

/**
 * Tells Twilio this device should be rung for calls to the shop.
 *
 * Registration is per access token and expires with it, so this runs at sign
 * in and again whenever the app comes back to the foreground — an expired
 * registration fails silently, and a device that has quietly stopped being
 * rung is exactly the failure staff cannot see.
 */
export async function registerForVoicePush(): Promise<void> {
  const { token } = await getVoiceAccessToken(currentPlatform());
  await getVoiceDevice().register(token);
}

/** Stops this device being rung — on sign out, so a shared phone goes quiet. */
export async function unregisterVoicePush(): Promise<void> {
  try {
    const { token } = await getVoiceAccessToken(currentPlatform());
    await getVoiceDevice().unregister(token);
  } catch {
    // Signing out with no network still has to sign the user out; Twilio drops
    // the registration with the token when it expires anyway.
  }
}

/**
 * Subscribes to inbound call invites. Returns an unsubscribe function.
 *
 * On iOS the SDK has already reported the invite to CallKit by the time this
 * fires — iOS requires that within milliseconds of the VoIP push — so the
 * phone is ringing before the listener runs. The listener's job is to mirror
 * that call into the app's own UI, not to start the ring.
 */
export function onCallInvite(listener: (invite: CallInvite) => void): () => void {
  const voice = getVoiceDevice();
  voice.on(Voice.Event.CallInvite, listener);
  return () => {
    voice.removeListener(Voice.Event.CallInvite, listener);
  };
}

/** Invites the SDK is already holding — for a cold start into a ringing call. */
export async function getPendingCallInvites(): Promise<CallInvite[]> {
  try {
    const invites = await getVoiceDevice().getCallInvites();
    return Array.from(invites.values());
  } catch {
    return [];
  }
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
 * Superseded by CallInvite.accept(): inbound calls are real Twilio invites
 * again, so answering no longer means dialing back into a queue. Kept, with
 * its server half (/outgoing's Mode=answer and the queue TwiML), because it is
 * the whole fallback if CallKit has to be backed out a second time.
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

/**
 * Disconnects any call the SDK still knows about.
 *
 * CallKit is configured by the SDK with maximumCallGroups = 1 and
 * maximumCallsPerCallGroup = 1, so a single call left half-open blocks every
 * later one: CXStartCallAction is refused, and the SDK's connect() then
 * neither resolves nor rejects (it only logs), wedging the UI on "Calling…"
 * with no Call object to hang up. Sweeping before dialing and after a failure
 * is what keeps one bad attempt from poisoning all the rest.
 */
export async function releaseStrayCalls(): Promise<void> {
  try {
    const calls = await getVoiceDevice().getCalls();
    await Promise.all(
      Array.from(calls.values()).map((call) =>
        call.disconnect().catch(() => {
          // Already gone — nothing to release.
        })
      )
    );
  } catch {
    // Best-effort cleanup; never block placing or ending a call.
  }
}

/**
 * Rejects if the SDK doesn't settle in time. connect() can hang indefinitely
 * when CallKit refuses the call, and an unbounded await there is what left the
 * call screen stuck with a dead End button.
 */
export function withConnectTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The call couldn't be connected. Please try again.")),
      ms
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
