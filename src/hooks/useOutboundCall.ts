import { useCallback, useRef, useState } from "react";
import { Call } from "@twilio/voice-react-native-sdk";
import { placeOutboundCall } from "@/lib/voice";

export type OutboundCallStatus =
  | "idle"
  | "connecting"
  | "ringing"
  | "connected"
  | "disconnected"
  | "failed";

export type OutboundCallState = {
  status: OutboundCallStatus;
  toNumber: string | null;
  displayName: string | null;
  error: string | null;
  isMuted: boolean;
};

const IDLE_STATE: OutboundCallState = {
  status: "idle",
  toNumber: null,
  displayName: null,
  error: null,
  isMuted: false,
};

/** Manages the lifecycle of a single outbound Voice SDK call for a screen. */
export function useOutboundCall() {
  const [state, setState] = useState<OutboundCallState>(IDLE_STATE);
  const callRef = useRef<Call | null>(null);

  const startCall = useCallback(async (toNumber: string, displayName?: string) => {
    setState({ ...IDLE_STATE, status: "connecting", toNumber, displayName: displayName ?? null });

    try {
      const call = await placeOutboundCall(toNumber, displayName);
      callRef.current = call;

      call.on(Call.Event.Ringing, () => {
        setState((prev) => ({ ...prev, status: "ringing" }));
      });
      call.on(Call.Event.Connected, () => {
        setState((prev) => ({ ...prev, status: "connected" }));
      });
      call.on(Call.Event.Disconnected, (error) => {
        callRef.current = null;
        setState((prev) => ({
          ...prev,
          status: "disconnected",
          error: error?.message ?? null,
        }));
      });
      call.on(Call.Event.ConnectFailure, (error) => {
        callRef.current = null;
        setState((prev) => ({ ...prev, status: "failed", error: error?.message ?? null }));
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: error instanceof Error ? error.message : "Unable to place call",
      }));
    }
  }, []);

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
    setState(IDLE_STATE);
  }, []);

  return { state, startCall, hangUp, toggleMute, reset };
}
