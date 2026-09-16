import { createContext, useContext, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useOutboundCall, type OutboundCallState } from "@/hooks/useOutboundCall";
import { useTheme } from "@/lib/ThemeContext";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";

type CallContextValue = {
  state: OutboundCallState;
  startCall: (toNumber: string, displayName?: string) => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
}

const STATUS_LABEL: Record<OutboundCallState["status"], string> = {
  idle: "",
  connecting: "Calling…",
  ringing: "Ringing…",
  connected: "On call",
  disconnected: "Call ended",
  failed: "Call failed",
};

function CallOverlay({ state, hangUp, toggleMute }: CallContextValue) {
  const { theme } = useTheme();

  if (state.status === "idle") return null;

  const isActive = state.status === "connecting" || state.status === "ringing" || state.status === "connected";

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: spacing[10] ?? 40,
        paddingBottom: spacing[3],
        paddingHorizontal: spacing[4],
        backgroundColor: colors.emerald[600],
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
        {state.displayName ? (
          <Text style={{ color: colors.emerald[50], ...fontSize.xs }}>{state.displayName}</Text>
        ) : null}
        {state.error ? (
          <Text style={{ color: colors.emerald[50], ...fontSize.xs }}>{state.error}</Text>
        ) : null}
      </View>

      {isActive ? (
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
            <Ionicons name="call" size={20} color={colors.white} style={{ transform: [{ rotate: "135deg" }] }} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { state, startCall, hangUp, toggleMute } = useOutboundCall();
  const value: CallContextValue = { state, startCall, hangUp, toggleMute };

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay {...value} />
    </CallContext.Provider>
  );
}
