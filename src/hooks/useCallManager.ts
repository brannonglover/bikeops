import { useCallback, useEffect, useRef, useState } from "react";
import { Call, CallInvite } from "@twilio/voice-react-native-sdk";
import { callInviteFrom, onCallInvite, placeOutboundCall } from "@/lib/voice";

export type CallStatus =
  | "idle"
  | "connecting"
  | "ringing"
  | "incoming"
  | "connected"
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
};

const DISMISS_DELAY_MS = 3_000;

const IDLE_STATE: CallState = {
  status: "idle",
  number: null,
  displayName: null,
  direction: null,
  error: null,
  isMuted: false,
};

/**
 * Owns the single active call for the app — outbound dials and inbound
 * invites alike. Inbound requires registerForIncomingCalls() to have run;
 * this hook only listens, it does not register (see CallProvider).
 */
export function useCallManager() {
  const [state, setState] = useState<CallState>(IDLE_STATE);
  const callRef = useRef<Call | null>(null);
  const inviteRef = useRef<CallInvite | null>(null);

  /** Wires the shared lifecycle events every connected call needs. */
  const attachCallListeners = useCallback((call: Call) => {
    callRef.current = call;

    call.on(Call.Event.Ringing, () => {
      setState((prev) => ({ ...prev, status: "ringing" }));
    });
    call.on(Call.Event.Connected, () => {
      setState((prev) => ({ ...prev, status: "connected" }));
    });
    call.on(Call.Event.Disconnected, (error) => {
      callRef.current = null;
      inviteRef.current = null;
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        error: error?.message ?? null,
      }));
    });
    call.on(Call.Event.ConnectFailure, (error) => {
      callRef.current = null;
      inviteRef.current = null;
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
        attachCallListeners(await placeOutboundCall(toNumber, displayName));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: error instanceof Error ? error.message : "Unable to place call",
        }));
      }
    },
    [attachCallListeners]
  );

  // Inbound invites. The caller may hang up before we answer, so Cancelled
  // has to clear the ringing UI or it strands on screen.
  useEffect(() => {
    return onCallInvite((invite) => {
      inviteRef.current = invite;
      setState({
        ...IDLE_STATE,
        status: "incoming",
        number: callInviteFrom(invite),
        displayName: null,
        direction: "inbound",
      });

      // On iOS the call is usually answered from the CallKit screen rather than
      // our overlay, so accept() is never called from JS — the SDK reports it
      // here instead. Without this the UI stays stuck on "incoming".
      invite.on(CallInvite.Event.Accepted, (call) => {
        inviteRef.current = null;
        attachCallListeners(call);
        setState((prev) => ({ ...prev, status: "connected" }));
      });

      invite.on(CallInvite.Event.Rejected, () => {
        inviteRef.current = null;
        setState(IDLE_STATE);
      });

      invite.on(CallInvite.Event.Cancelled, () => {
        inviteRef.current = null;
        setState((prev) =>
          prev.status === "incoming" ? { ...IDLE_STATE, status: "disconnected" } : prev
        );
      });
    });
  }, [attachCallListeners]);

  const acceptIncoming = useCallback(async () => {
    const invite = inviteRef.current;
    if (!invite) return;
    setState((prev) => ({ ...prev, status: "connecting" }));
    try {
      attachCallListeners(await invite.accept());
      inviteRef.current = null;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: error instanceof Error ? error.message : "Unable to answer call",
      }));
    }
  }, [attachCallListeners]);

  const rejectIncoming = useCallback(async () => {
    const invite = inviteRef.current;
    if (!invite) return;
    inviteRef.current = null;
    try {
      await invite.reject();
    } finally {
      setState(IDLE_STATE);
    }
  }, []);

  // "Call ended"/"Call failed" are terminal — show them briefly, then clear the
  // overlay instead of leaving it pinned over the app.
  useEffect(() => {
    if (state.status !== "disconnected" && state.status !== "failed") return;
    const timer = setTimeout(() => setState(IDLE_STATE), DISMISS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.status]);

  const hangUp = useCallback(async () => {
    await callRef.current?.disconnect();
  }, []);

  const toggleMute = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    const next = !state.isMuted;
    await call.mute(next);
    setState((prev) => ({ ...prev, isMuted: next }));
  }, [state.isMuted]);

  const reset = useCallback(() => {
    callRef.current = null;
    inviteRef.current = null;
    setState(IDLE_STATE);
  }, []);

  return { state, startCall, acceptIncoming, rejectIncoming, hangUp, toggleMute, reset };
}
