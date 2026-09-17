import { useCallback, useEffect, useRef, useState } from "react";
import { AudioDevice, Call } from "@twilio/voice-react-native-sdk";
import {
  answerQueuedCall,
  listAudioDevices,
  onAudioDevicesUpdated,
  placeOutboundCall,
  releaseStrayCalls,
  selectAudioDevice,
  withConnectTimeout,
} from "@/lib/voice";
import { declineCall } from "@/lib/api";

export type CallStatus =
  | "idle"
  | "connecting"
  | "ringing"
  | "incoming"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export type CallState = {
  status: CallStatus;
  /** The other party — dialed number for outbound, caller for inbound. */
  number: string | null;
  displayName: string | null;
  direction: "inbound" | "outbound" | null;
  error: string | null;
  isMuted: boolean;
  /** Where call audio is routed right now — drives the speaker toggle. */
  audioRoute: AudioDevice.Type | null;
  /** When the media legs joined, for the in-call duration timer. */
  connectedAt: number | null;
  /** Server-side Call id of a ringing inbound call, from its notification. */
  pendingCallId: string | null;
};

const DISMISS_DELAY_MS = 3_000;

/**
 * How long to wait for the SDK to hand back a Call before giving up. The
 * native connect() can hang forever when CallKit refuses the call, so this is
 * the only thing standing between a refused call and a permanently stuck UI.
 */
const CONNECT_TIMEOUT_MS = 12_000;

const IDLE_STATE: CallState = {
  status: "idle",
  number: null,
  displayName: null,
  direction: null,
  error: null,
  isMuted: false,
  audioRoute: null,
  connectedAt: null,
  pendingCallId: null,
};

/**
 * Owns the single active call for the app — outbound dials and inbound calls
 * alike.
 *
 * Inbound calls arrive as ordinary push notifications, not Twilio invites:
 * the caller holds in a server-side queue and presentIncomingCall() puts the
 * ringing UI up. Answering dials into that queue. See lib/voice.ts for why
 * this app avoids PushKit entirely.
 */
export function useCallManager() {
  const [state, setState] = useState<CallState>(IDLE_STATE);
  const callRef = useRef<Call | null>(null);

  /** Wires the shared lifecycle events every connected call needs. */
  const attachCallListeners = useCallback((call: Call) => {
    callRef.current = call;

    call.on(Call.Event.Ringing, () => {
      setState((prev) => ({ ...prev, status: "ringing" }));
    });
    call.on(Call.Event.Connected, () => {
      setState((prev) => ({
        ...prev,
        status: "connected",
        // Reconnects re-fire Connected; keep the original start so the timer
        // shows the length of the call, not of the latest media session.
        connectedAt: prev.connectedAt ?? Date.now(),
      }));
    });
    call.on(Call.Event.Disconnected, (error) => {
      callRef.current = null;
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        error: error?.message ?? null,
      }));
    });
    call.on(Call.Event.Reconnecting, () => {
      setState((prev) => ({ ...prev, status: "reconnecting" }));
    });
    call.on(Call.Event.Reconnected, () => {
      setState((prev) => ({ ...prev, status: "connected" }));
    });
    call.on(Call.Event.ConnectFailure, (error) => {
      callRef.current = null;
      setState((prev) => ({ ...prev, status: "failed", error: error?.message ?? null }));
    });
  }, []);

  const startCall = useCallback(
    async (toNumber: string, displayName?: string) => {
      setState({
        ...IDLE_STATE,
        status: "connecting",
        number: toNumber,
        displayName: displayName ?? null,
        direction: "outbound",
      });

      try {
        // Clear anything a previous failed attempt left holding CallKit's
        // single call slot, or this dial is refused before it starts.
        await releaseStrayCalls();
        attachCallListeners(
          await withConnectTimeout(placeOutboundCall(toNumber, displayName), CONNECT_TIMEOUT_MS)
        );
      } catch (error) {
        await releaseStrayCalls();
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: error instanceof Error ? error.message : "Unable to place call",
        }));
      }
    },
    [attachCallListeners]
  );

  /**
   * Puts the ringing UI up for an inbound call announced by a notification.
   * Safe to call more than once for the same call: the notification fires on
   * arrival when the app is foregrounded, and again when it is tapped.
   */
  const presentIncomingCall = useCallback(
    (incoming: { callId: string; number: string; displayName?: string | null }) => {
      setState((prev) => {
        // A second caller must not hijack the screen mid-call, and a repeat
        // notification for the call already showing must not reset it. The
        // terminal states are fair game: they linger for a few seconds after
        // a call ends, and a new call arriving in that window should ring.
        const free =
          prev.status === "idle" ||
          prev.status === "disconnected" ||
          prev.status === "failed";
        if (!free) return prev;
        return {
          ...IDLE_STATE,
          status: "incoming",
          number: incoming.number,
          displayName: incoming.displayName ?? null,
          direction: "inbound",
          pendingCallId: incoming.callId,
        };
      });
    },
    []
  );

  /**
   * Answers by dialing into the queue the caller is holding in — there is no
   * invite to accept. The server bridges the two legs.
   */
  const acceptIncoming = useCallback(async () => {
    const callId = state.pendingCallId;
    if (!callId) return;
    setState((prev) => ({ ...prev, status: "connecting" }));
    try {
      await releaseStrayCalls();
      attachCallListeners(
        await withConnectTimeout(
          answerQueuedCall(callId, state.displayName ?? undefined),
          CONNECT_TIMEOUT_MS
        )
      );
    } catch (error) {
      // Leaving the refused call in place would block the next answer too.
      await releaseStrayCalls();
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: error instanceof Error ? error.message : "Unable to answer call",
      }));
    }
  }, [attachCallListeners, state.pendingCallId, state.displayName]);

  const rejectIncoming = useCallback(async () => {
    const callId = state.pendingCallId;
    setState(IDLE_STATE);
    if (!callId) return;
    try {
      // Sends the caller to voicemail now instead of leaving them on hold for
      // the remainder of the ring window.
      await declineCall(callId);
    } catch {
      // They still time out to voicemail on their own — nothing to recover.
    }
  }, [state.pendingCallId]);

  // "Call ended"/"Call failed" are terminal — show them briefly, then clear the
  // overlay instead of leaving it pinned over the app.
  useEffect(() => {
    if (state.status !== "disconnected" && state.status !== "failed") return;
    const timer = setTimeout(() => setState(IDLE_STATE), DISMISS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.status]);

  /**
   * End always clears the screen, even when no Call object was ever handed
   * back. Without that, a connect() that never settled left the user staring
   * at "Calling…" with an inert button and no way out but force-quitting.
   */
  const hangUp = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    setState(IDLE_STATE);
    try {
      if (call) await call.disconnect();
    } finally {
      // Covers the wedged case, where CallKit holds a call the JS never saw.
      await releaseStrayCalls();
    }
  }, []);

  const toggleMute = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    const next = !state.isMuted;
    await call.mute(next);
    setState((prev) => ({ ...prev, isMuted: next }));
  }, [state.isMuted]);

  /**
   * Flips between earpiece and speaker. A paired bluetooth headset counts as
   * "not speakerphone", so turning the speaker off from there hands audio back
   * to the headset rather than forcing the earpiece.
   */
  const toggleSpeaker = useCallback(async () => {
    const wantSpeaker = state.audioRoute !== AudioDevice.Type.Speaker;
    if (wantSpeaker) {
      if (await selectAudioDevice(AudioDevice.Type.Speaker)) {
        setState((prev) => ({ ...prev, audioRoute: AudioDevice.Type.Speaker }));
      }
      return;
    }
    // Prefer bluetooth on the way back; fall back to the earpiece.
    for (const type of [AudioDevice.Type.Bluetooth, AudioDevice.Type.Earpiece]) {
      if (await selectAudioDevice(type)) {
        setState((prev) => ({ ...prev, audioRoute: type }));
        return;
      }
    }
  }, [state.audioRoute]);

  /** Sends a DTMF tone — for phone trees reached from an outbound call. */
  const sendDigits = useCallback(async (digits: string) => {
    await callRef.current?.sendDigits(digits);
  }, []);

  // Track the live route so the speaker button reflects reality: Twilio moves
  // audio on its own when a headset connects or CallKit answers a call.
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const { selected } = await listAudioDevices();
        if (cancelled) return;
        setState((prev) => ({ ...prev, audioRoute: selected?.type ?? null }));
      } catch {
        // Route readback is cosmetic — a failure just leaves the toggle as-is.
      }
    };

    void sync();
    const unsubscribe = onAudioDevicesUpdated((_devices, selected) => {
      setState((prev) => ({ ...prev, audioRoute: selected?.type ?? prev.audioRoute }));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const reset = useCallback(() => {
    callRef.current = null;
    setState(IDLE_STATE);
  }, []);

  return {
    state,
    startCall,
    presentIncomingCall,
    acceptIncoming,
    rejectIncoming,
    hangUp,
    toggleMute,
    toggleSpeaker,
    sendDigits,
    reset,
  };
}
