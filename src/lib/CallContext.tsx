import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallManager, type CallState } from "@/hooks/useCallManager";
import { useAuth } from "@/lib/auth";
import { registerForIncomingCalls, unregisterForIncomingCalls } from "@/lib/voice";
import { useTheme } from "@/lib/ThemeContext";
import { formatPhoneNumber } from "@/lib/format";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";

export type RegistrationState = {
  status: "idle" | "registering" | "registered" | "failed";
  error: string | null;
};

type CallContextValue = {
  state: CallState;
  /** Whether this device can actually receive inbound calls. */
  registration: RegistrationState;
  startCall: (toNumber: string, displayName?: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
}

const STATUS_LABEL: Record<CallState["status"], string> = {
  idle: "",
  connecting: "Calling…",
  ringing: "Ringing…",
  incoming: "Incoming call",
  connected: "On call",
  disconnected: "Call ended",
  failed: "Call failed",
};

function CallOverlay({
  state,
  acceptIncoming,
  rejectIncoming,
  hangUp,
  toggleMute,
}: CallContextValue) {
  useTheme();

  if (state.status === "idle") return null;

  const isIncoming = state.status === "incoming";
  const isActive =
    state.status === "connecting" || state.status === "ringing" || state.status === "connected";

  // Unknown callers have no name — the number is the only identity we have.
  const title =
    state.displayName ?? (state.number ? formatPhoneNumber(state.number) : "Unknown caller");

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: spacing[10],
        paddingBottom: spacing[3],
        paddingHorizontal: spacing[4],
        backgroundColor: isIncoming ? colors.slate[700] : colors.emerald[600],
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 1000,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.white, fontWeight: "600", ...fontSize.sm }}>
          {STATUS_LABEL[state.status]}
        </Text>
        <Text style={{ color: colors.emerald[50], ...fontSize.xs }}>{title}</Text>
        {state.error ? (
          <Text style={{ color: colors.emerald[50], ...fontSize.xs }}>{state.error}</Text>
        ) : null}
      </View>

      {isIncoming ? (
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          <Pressable
            onPress={rejectIncoming}
            style={{
              padding: spacing[2],
              borderRadius: borderRadius.full,
              backgroundColor: colors.red[600],
            }}
            accessibilityRole="button"
            accessibilityLabel="Decline call"
          >
            <Ionicons
              name="call"
              size={20}
              color={colors.white}
              style={{ transform: [{ rotate: "135deg" }] }}
            />
          </Pressable>
          <Pressable
            onPress={acceptIncoming}
            style={{
              padding: spacing[2],
              borderRadius: borderRadius.full,
              backgroundColor: colors.emerald[600],
            }}
            accessibilityRole="button"
            accessibilityLabel="Answer call"
          >
            <Ionicons name="call" size={20} color={colors.white} />
          </Pressable>
        </View>
      ) : isActive ? (
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          <Pressable
            onPress={toggleMute}
            style={{
              padding: spacing[2],
              borderRadius: borderRadius.full,
              backgroundColor: state.isMuted ? colors.white : "transparent",
            }}
            accessibilityRole="button"
            accessibilityLabel={state.isMuted ? "Unmute" : "Mute"}
          >
            <Ionicons
              name={state.isMuted ? "mic-off" : "mic"}
              size={20}
              color={state.isMuted ? colors.emerald[600] : colors.white}
            />
          </Pressable>
          <Pressable
            onPress={hangUp}
            style={{
              padding: spacing[2],
              borderRadius: borderRadius.full,
              backgroundColor: colors.red[600],
            }}
            accessibilityRole="button"
            accessibilityLabel="Hang up"
          >
            <Ionicons
              name="call"
              size={20}
              color={colors.white}
              style={{ transform: [{ rotate: "135deg" }] }}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const MAX_REGISTER_ATTEMPTS = 5;
const REGISTER_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export function CallProvider({ children }: { children: ReactNode }) {
  const { state, startCall, acceptIncoming, rejectIncoming, hangUp, toggleMute } =
    useCallManager();
  const { staffUser } = useAuth();
  const [registration, setRegistration] = useState<RegistrationState>({
    status: "idle",
    error: null,
  });
  const registrationRef = useRef(registration);
  registrationRef.current = registration;

  // Only staff receive shop calls, and the token endpoint is staff-gated, so
  // registration follows the staff session rather than app launch.
  //
  // This retries rather than firing once: the token endpoint 404s while voice
  // is disabled for the shop, and a single silent failure left the device
  // permanently unable to receive calls until the app was force-quit.
  useEffect(() => {
    if (!staffUser) {
      setRegistration({ status: "idle", error: null });
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const register = async () => {
      if (cancelled) return;
      setRegistration((prev) => ({ status: "registering", error: prev.error }));
      try {
        await registerForIncomingCalls();
        if (cancelled) return;
        attempt = 0;
        setRegistration({ status: "registered", error: null });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Could not register for calls";
        setRegistration({ status: "failed", error: message });
        attempt += 1;
        if (attempt <= MAX_REGISTER_ATTEMPTS) {
          timer = setTimeout(register, REGISTER_BACKOFF_MS[attempt - 1]);
        }
      }
    };

    void register();

    // Coming back to the foreground is the cheapest signal that whatever was
    // wrong (server config, connectivity) may now be fixed.
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      if (registrationRef.current.status === "registered") return;
      attempt = 0;
      void register();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
      void unregisterForIncomingCalls().catch(() => {
        // Logout/teardown — nothing useful to do if Twilio is already gone.
      });
    };
  }, [staffUser]);

  const value: CallContextValue = {
    state,
    registration,
    startCall,
    acceptIncoming,
    rejectIncoming,
    hangUp,
    toggleMute,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay {...value} />
    </CallContext.Provider>
  );
}
