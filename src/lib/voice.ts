import { Platform } from "react-native";
import { setIsAudioActiveAsync } from "expo-audio";
import { AudioDevice, Call, CallInvite, CallKit, Voice } from "@twilio/voice-react-native-sdk";
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
 * Stands up the SDK's PushKit registry at launch.
 *
 * Kept for the sake of dialing, not ringing. The SDK's iOS CallKit path cannot
 * start any call without it, so dropping this breaks placing a call and
 * answering a queued one alike. It brings no inbound call in by itself: Twilio
 * sends a VoIP push only to a device that called voice.register(), which this
 * app deliberately does not — see registerForIncomingCalls. Has to run before
 * any dial.
 */
export async function initializePushRegistry(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await getVoiceDevice().initializePushRegistry();
}

/**
 * Keeps the shop's calls out of the system phone app.
 *
 * CXProviderConfiguration.includesCallsInRecents defaults to YES, so every
 * call the SDK touches was being written into Apple's Phone recents —
 * answering an inbound caller included, because answering is an outbound leg
 * dialed into the queue they are holding in. The shop's history belongs in
 * this app's own Calls list, which is built from the server's Call rows and
 * knows which customer a number belongs to; the system copy is a second,
 * dumber log of the same calls on what is often a shared phone.
 *
 * Replaces the CXProvider outright rather than amending it, so this must run
 * at launch — before initializePushRegistry readies the SDK to place a call,
 * and well before one exists to be orphaned by swapping the provider under it.
 */
export async function configureCallKit(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await getVoiceDevice().setCallKitConfiguration({
    callKitIncludesCallsInRecents: false,
    // Restated because this call replaces the whole configuration, defaults
    // included: one group holding one call, which is the invariant
    // releaseStrayCalls exists to keep from wedging every later dial.
    callKitMaximumCallGroups: 1,
    callKitMaximumCallsPerCallGroup: 1,
    // A partial configuration: the native side reads each key independently
    // and falls back to its own default for anything absent, but the SDK
    // types the argument as the complete set. Naming the two image/sound
    // fields just to satisfy that would hand CallKit an empty filename.
  } as CallKit.ConfigurationOptions);
}

/**
 * Hands the app's audio session back before a call is placed.
 *
 * Audio elsewhere in the app activates the process-wide AVAudioSession and
 * leaves it active. That is the session the SDK has to hand to CallKit to
 * start a call, and a refused CXStartCallAction leaves connect() neither
 * resolving nor rejecting: the screen sits on "Answering…" and no call ever
 * reaches Twilio. It is the same failure the in-app ring caused before it was
 * removed, which is why this guards the connect itself rather than any one
 * thing that plays audio.
 *
 * Reaches expo-audio and nothing else — in practice the greeting recorder and
 * its preview. This is narrower than it looks, and the gap has already cost
 * the shop a day of calling: voicemail playback moved to expo-video, which
 * keeps a session of its own that setIsAudioActiveAsync cannot touch, so this
 * guard ran, reported success, and released nothing. Playback is handled
 * where it starts instead — see audioMixingMode in VoicemailPanel. Anything
 * new that makes a sound belongs in one of those two places; this function is
 * not the catch-all its position in the connect path suggests.
 */
async function releaseAudioSession(): Promise<void> {
  try {
    await setIsAudioActiveAsync(false);
  } catch {
    // Busy, or never activated in the first place. Worth dialing regardless.
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
  await releaseAudioSession();
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
  await releaseAudioSession();
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


/**
 * Registers this device to receive inbound calls as Twilio Client invites.
 *
 * Deliberately not called. Registering is what hands inbound calls to the
 * operating system: Twilio delivers the invite as a VoIP push, and iOS then
 * *requires* every VoIP push to be reported to CallKit, so the call is
 * answered on Apple's incoming-call screen and filed in Apple's phone app
 * rather than in BikeOps. Not registering is the only way for the app's own
 * call screen to be the one that rings — which is why inbound calls are
 * announced by an ordinary notification instead (see answerQueuedCall).
 *
 * Kept, with its counterpart below, as the rollback: the server half is still
 * there too, behind NATIVE_RING_SUPPORTED_BY_APP in bikeopsco's voice-legs.ts.
 * Calling this again without flipping that constant rings nothing, and
 * flipping that constant without calling this again sends callers to
 * voicemail in silence. The two move together or not at all.
 *
 * Requires a push credential configured on the Twilio side, which the access
 * token carries. Without one the registration still succeeds and no push is
 * ever sent, so a silent device is the expected symptom of a missing
 * TWILIO_IOS_PUSH_CREDENTIAL_SID / TWILIO_ANDROID_PUSH_CREDENTIAL_SID.
 */
export async function registerForIncomingCalls(): Promise<void> {
  const { token } = await getVoiceAccessToken(currentPlatform());
  await getVoiceDevice().register(token);
}

/**
 * Stops inbound calls reaching this device. Called on sign-out so a phone that
 * has been handed on does not keep ringing for the shop.
 */
export async function unregisterForIncomingCalls(): Promise<void> {
  const { token } = await getVoiceAccessToken(currentPlatform());
  await getVoiceDevice().unregister(token);
}

/** Details the server attached to an invite via the `To` query string. */
export type IncomingInvite = {
  invite: CallInvite;
  callId: string | null;
  displayName: string | null;
  from: string;
};

function describeInvite(invite: CallInvite): IncomingInvite {
  // Set by fanOutStaffLegs on the server. `callId` is what ties the ringing
  // invite back to the Call row, which is how the rest of the app finds the
  // customer, the conversation and the history for this caller.
  const params = invite.getCustomParameters();
  const callId = typeof params.callId === "string" ? params.callId : null;
  const name = typeof params.name === "string" ? params.name.trim() : "";
  return {
    invite,
    callId,
    displayName: name.length > 0 ? name : null,
    from: invite.getFrom(),
  };
}

/**
 * Subscribes to inbound call invites. Returns an unsubscribe function.
 *
 * The OS is already ringing by the time this fires — the SDK reports the call
 * natively before JS is necessarily awake — so this is about mirroring that
 * into the app's own state, not about starting the ring.
 */
export function onIncomingCallInvite(
  listener: (incoming: IncomingInvite) => void
): () => void {
  const voice = getVoiceDevice();
  const handler = (invite: CallInvite) => listener(describeInvite(invite));
  voice.on(Voice.Event.CallInvite, handler);
  return () => {
    voice.removeListener(Voice.Event.CallInvite, handler);
  };
}

/**
 * Invites already pending when JS starts.
 *
 * A call that arrives while the app is terminated is reported to CallKit by the
 * native layer and may be answered there before a line of JS has run, so the
 * event above is missed entirely. This is how that call is picked up on boot.
 */
export async function getPendingCallInvites(): Promise<IncomingInvite[]> {
  const invites = await getVoiceDevice().getCallInvites();
  return Array.from(invites.values()).map(describeInvite);
}

/** The Call the SDK is already running, if JS started after one was answered. */
export async function getActiveCall(): Promise<Call | null> {
  try {
    const calls = await getVoiceDevice().getCalls();
    return Array.from(calls.values())[0] ?? null;
  } catch {
    return null;
  }
}
