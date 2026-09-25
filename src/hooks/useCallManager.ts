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
  | "failed"
  /** Rang out: the caller has been handed to voicemail and is no longer ours. */
  | "voicemail";

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
  /**
   * When an inbound caller's hold runs out and the server sends them to
   * voicemail, as epoch milliseconds. Past this moment there is nobody left in
   * the queue to answer, which is what retires the Answer button.
   */
  ringEndsAt: number | null;
};

const DISMISS_DELAY_MS = 3_000;

/**
 * Longer than a plain failure, because this one has something to read: what
 * happened to the caller and why ringing them straight back won't work.
 */
const VOICEMAIL_DISMISS_DELAY_MS = 12_000;

/**
 * Fallback ring window when a notification predates the server sending its own
 * deadline, matching RING_SECONDS in the server's voice-twiml. Only ever a
 * fallback: the server's value accounts for how long the caller has already
 * been holding, which a device woken by the fourth repeat of the ring cannot
 * work out for itself.
 */
export const RING_WINDOW_MS = 25_000;

/**
 * What to call the pre-connect phase. Direction is the whole story: dialing
 * out is "Calling", picking up is "Answering". Reporting the SDK's internal
 * progression instead made a single answer read as "Calling" then "Ringing"
 * before any audio, which looked like two things happening rather than one.
 */
export function callProgressLabel(state: CallState): string {
  switch (state.status) {
    case "connecting":
    case "ringing":
      return state.direction === "inbound" ? "Answering…" : "Calling…";
    case "incoming":
      return "Incoming call";
    case "voicemail":
      return "Sent to voicemail";
    case "reconnecting":
      return "Reconnecting…";
    case "disconnected":
      return "Call ended";
    case "failed":
      return "Call failed";
    default:
      return "";
  }
}

/**
 * How long to wait for the SDK to hand back a Call before giving up. The
 * native connect() can hang forever when CallKit refuses the call, so this is
 * the only thing standing between a refused call and a permanently stuck UI.
 */
const CONNECT_TIMEOUT_MS = 12_000;

/**
 * How long a call may sit in "connecting" without a word from the SDK.
 *
 * connect() resolving is not the same as a call existing: when the native
 * layer can't start one — CallKit refusing it, most often — a Call object
 * comes back and then never fires a single event, so CONNECT_TIMEOUT_MS above
 * never sees a failure to report. This is the backstop for that, and the
 * reason answering can no longer leave the screen reading "Answering…" until
 * the app is force-quit.
 */
const CONNECT_SILENCE_TIMEOUT_MS = 20_000;

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
  ringEndsAt: null,
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
  /**
   * Set when the user ends the call themselves. hangUp() clears the screen
   * immediately, but disconnect() still fires Disconnected a moment later —
   * without this the overlay would slide away and then bounce straight back
   * showing "Call ended".
   */
  const endedByUserRef = useRef(false);

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
      if (endedByUserRef.current) {
        // Already back at idle by the user's own action; nothing to announce.
        endedByUserRef.current = false;
        return;
      }
      setState((prev) => {
        if (error) {
          return { ...prev, status: "disconnected", error: error.message ?? null };
        }
        // A leg that never connected did not "end" — it never got through.
        // Twilio reports a busy or unanswered number by simply ending the
        // call, so without this a dial to a customer who is mid-voicemail
        // read as nothing happening at all: "Calling…" for a few seconds and
        // then the screen quietly vanishing.
        if (prev.direction === "outbound" && prev.connectedAt === null) {
          return {
            ...prev,
            status: "disconnected",
            error: "They didn't pick up — the line was busy or rang out.",
          };
        }
        // The inbound equivalent: the answer leg found nobody in the queue,
        // so the caller had already been handed on.
        if (prev.direction === "inbound" && prev.connectedAt === null) {
          return { ...prev, status: "voicemail", error: null };
        }
        // A call that ran its course needs no announcement — the screen going
        // away is the message.
        return IDLE_STATE;
      });
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
      endedByUserRef.current = false;
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
    (incoming: {
      callId: string;
      number: string;
      displayName?: string | null;
      ringEndsAt?: number | null;
    }) => {
      const ringEndsAt = incoming.ringEndsAt ?? Date.now() + RING_WINDOW_MS;
      setState((prev) => {
        // A second caller must not hijack the screen mid-call, and a repeat
        // notification for the call already showing must not reset it. The
        // terminal states are fair game: they linger for a few seconds after
        // a call ends, and a new call arriving in that window should ring.
        const free =
          prev.status === "idle" ||
          prev.status === "disconnected" ||
          prev.status === "failed" ||
          prev.status === "voicemail";
        if (!free) return prev;
        return {
          ...IDLE_STATE,
          // A notification tapped after the window closed announces a caller
          // who has already been handed to voicemail. Offering Answer there is
          // what sent staff into a call that rang and then failed, so say what
          // happened instead of ringing for someone who is no longer holding.
          status: ringEndsAt <= Date.now() ? "voicemail" : "incoming",
          number: incoming.number,
          displayName: incoming.displayName ?? null,
          direction: "inbound",
          pendingCallId: incoming.callId,
          ringEndsAt,
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
    // Tapped in the instant the window closed. Dialing now would bridge into
    // an empty queue and fail a few seconds later with nothing to explain it.
    if (state.ringEndsAt !== null && Date.now() >= state.ringEndsAt) {
      setState((prev) => ({ ...prev, status: "voicemail", error: null }));
      return;
    }
    endedByUserRef.current = false;
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
      const rangOut = state.ringEndsAt !== null && Date.now() >= state.ringEndsAt;
      setState((prev) =>
        // The window ran out mid-answer, so this isn't a call that broke — it
        // is a caller who left. Report the reason rather than a bare failure.
        rangOut
          ? { ...prev, status: "voicemail", error: null }
          : {
              ...prev,
              status: "failed",
              error: error instanceof Error ? error.message : "Unable to answer call",
            }
      );
    }
  }, [attachCallListeners, state.pendingCallId, state.displayName, state.ringEndsAt]);

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

  // A connect that never came to anything: no Ringing, no Connected, no
  // Disconnected. Tear down whatever the SDK handed back and say so, rather
  // than leaving an inert screen over the app.
  useEffect(() => {
    if (state.status !== "connecting") return;
    const timer = setTimeout(() => {
      const call = callRef.current;
      callRef.current = null;
      // The Disconnected this disconnect() provokes must not overwrite the
      // failure below with the quieter "call ended".
      endedByUserRef.current = true;
      void (async () => {
        try {
          await call?.disconnect();
        } finally {
          await releaseStrayCalls();
        }
      })();
      setState((prev) =>
        prev.status === "connecting"
          ? {
              ...prev,
              status: "failed",
              error: "The call couldn't be connected. Please try again.",
            }
          : prev
      );
    }, CONNECT_SILENCE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.status]);

  // Only failures reach these states now, and they clear themselves rather
  // than leaving the overlay pinned over the app waiting to be dismissed.
  useEffect(() => {
    if (
      state.status !== "disconnected" &&
      state.status !== "failed" &&
      state.status !== "voicemail"
    ) {
      return;
    }
    const timer = setTimeout(
      () => setState(IDLE_STATE),
      state.status === "voicemail" ? VOICEMAIL_DISMISS_DELAY_MS : DISMISS_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [state.status]);

  /**
   * Retires the answer buttons the moment the caller's hold runs out.
   *
   * Nothing tells the app that a caller gave up waiting: the ring is a string
   * of notifications that simply stops arriving, so a screen left on
   * "Incoming call" would sit there offering to answer a queue with nobody in
   * it. The server sends the deadline with every ring; this is what acts on
   * it.
   */
  useEffect(() => {
    if (state.status !== "incoming" || state.ringEndsAt === null) return;
    const timer = setTimeout(
      () =>
        setState((prev) =>
          prev.status === "incoming" ? { ...prev, status: "voicemail" } : prev
        ),
      Math.max(state.ringEndsAt - Date.now(), 0)
    );
    return () => clearTimeout(timer);
  }, [state.status, state.ringEndsAt]);

  /**
   * End always clears the screen, even when no Call object was ever handed
   * back. Without that, a connect() that never settled left the user staring
   * at "Calling…" with an inert button and no way out but force-quitting.
   */
  const hangUp = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    endedByUserRef.current = true;
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
