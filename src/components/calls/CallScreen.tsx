import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AudioDevice } from "@twilio/voice-react-native-sdk";
import { DialPad } from "@/components/calls/DialPad";
import { useCallerLookup } from "@/hooks/useCallerLookup";
import { customerName, formatPhoneNumber } from "@/lib/format";
import { formatPlaybackTime } from "@/lib/calls";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import type { CallState } from "@/hooks/useCallManager";

export interface CallScreenProps {
  state: CallState;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  sendDigits: (digits: string) => Promise<void>;
  /** Drops back to the compact banner so the app stays usable mid-call. */
  onMinimize: () => void;
}

const STATUS_LABEL: Record<CallState["status"], string> = {
  idle: "",
  connecting: "Calling…",
  ringing: "Ringing…",
  incoming: "Incoming call",
  connected: "",
  reconnecting: "Reconnecting…",
  disconnected: "Call ended",
  failed: "Call failed",
};

/** Seconds since the call connected, ticking once a second. */
function useCallDuration(connectedAt: number | null): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (connectedAt === null) {
      setSeconds(null);
      return;
    }
    const tick = () => setSeconds(Math.floor((Date.now() - connectedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [connectedAt]);

  return seconds;
}

/**
 * The app's own full-screen call UI, for both answering and talking. On iOS
 * the system still shows CallKit for a call that arrives while the app is
 * backgrounded — Apple requires a VoIP push to be reported there — so this
 * takes over once the app is in the foreground rather than replacing it.
 */
export function CallScreen({
  state,
  acceptIncoming,
  rejectIncoming,
  hangUp,
  toggleMute,
  toggleSpeaker,
  sendDigits,
  onMinimize,
}: CallScreenProps) {
  const insets = useSafeAreaInsets();
  const customer = useCallerLookup(state.number);
  const duration = useCallDuration(state.connectedAt);
  const [showKeypad, setShowKeypad] = useState(false);
  // Digits typed during the call, echoed above the pad like a desk phone.
  const [dtmf, setDtmf] = useState("");

  const isIncoming = state.status === "incoming";
  const isConnected = state.status === "connected" || state.status === "reconnecting";
  const isOver = state.status === "disconnected" || state.status === "failed";

  // A new call should never inherit the last one's open keypad.
  useEffect(() => {
    if (state.status !== "idle") return;
    setShowKeypad(false);
    setDtmf("");
  }, [state.status]);

  const pulse = useIncomingPulse(isIncoming);

  const title =
    state.displayName ??
    (customer ? customerName(customer) : null) ??
    (state.number ? formatPhoneNumber(state.number) : "Unknown caller");

  // Don't print the number twice when it *is* the title.
  const subtitle =
    state.number && title !== formatPhoneNumber(state.number)
      ? formatPhoneNumber(state.number)
      : null;

  const statusLine = isConnected
    ? state.status === "reconnecting"
      ? STATUS_LABEL.reconnecting
      : duration !== null
        ? formatPlaybackTime(duration)
        : "On call"
    : STATUS_LABEL[state.status];

  const handleKeypadPress = (digit: string) => {
    setDtmf((prev) => prev + digit);
    void sendDigits(digit);
  };

  return (
    <Modal
      visible={state.status !== "idle"}
      animationType="slide"
      transparent={false}
      // The call is the task; a stray back gesture shouldn't drop the UI while
      // leaving the call up. Minimize is the deliberate way out.
      onRequestClose={onMinimize}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
    >
      <View style={[styles.root, { paddingTop: insets.top + spacing[2] }]}>
        <View style={styles.topBar}>
          <Pressable
            onPress={onMinimize}
            hitSlop={12}
            style={styles.minimizeButton}
            accessibilityRole="button"
            accessibilityLabel="Minimize call"
          >
            <Ionicons name="chevron-down" size={24} color={colors.slate[300]} />
          </Pressable>
          <Text style={styles.topBarLabel}>
            {state.direction === "outbound" ? "Outgoing call" : "BikeOps call"}
          </Text>
          {/* Balances the minimize button so the label stays centred. */}
          <View style={styles.minimizeButton} />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[styles.avatar, { transform: [{ scale: pulse }] }]}
          >
            <Ionicons
              name={customer ? "person" : "call"}
              size={44}
              color={colors.white}
            />
          </Animated.View>

          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {statusLine ? <Text style={styles.status}>{statusLine}</Text> : null}
          {customer === null && state.number && !isOver ? (
            <Text style={styles.newCaller}>Not a customer yet</Text>
          ) : null}
          {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

          {showKeypad && isConnected ? (
            <View style={styles.keypadSection}>
              <Text style={styles.dtmf} numberOfLines={1}>
                {dtmf}
              </Text>
              <DialPad onPress={handleKeypadPress} variant="overlay" />
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[6] }]}>
          {isConnected ? (
            <View style={styles.actionRow}>
              <CallAction
                icon={state.isMuted ? "mic-off" : "mic"}
                label={state.isMuted ? "Unmuted" : "Mute"}
                active={state.isMuted}
                onPress={() => void toggleMute()}
              />
              <CallAction
                icon="keypad"
                label="Keypad"
                active={showKeypad}
                onPress={() => setShowKeypad((prev) => !prev)}
              />
              <CallAction
                icon="volume-high"
                label="Speaker"
                active={state.audioRoute === AudioDevice.Type.Speaker}
                onPress={() => void toggleSpeaker()}
              />
            </View>
          ) : null}

          {isIncoming ? (
            <View style={styles.answerRow}>
              <BigButton
                icon="call"
                rotate
                color={colors.red[600]}
                label="Decline"
                onPress={() => void rejectIncoming()}
              />
              <BigButton
                icon="call"
                color={colors.emerald[600]}
                label="Answer"
                onPress={() => void acceptIncoming()}
              />
            </View>
          ) : isOver ? null : (
            <View style={styles.answerRow}>
              <BigButton
                icon="call"
                rotate
                color={colors.red[600]}
                label="End"
                onPress={() => void hangUp()}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Slow breathing pulse on the avatar while the phone is ringing. */
function useIncomingPulse(active: boolean): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.08,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, scale]);

  return scale;
}

function CallAction({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <View
        style={[
          styles.actionCircle,
          { backgroundColor: active ? colors.white : "rgba(255,255,255,0.14)" },
        ]}
      >
        <Ionicons
          name={icon}
          size={24}
          color={active ? colors.slate[900] : colors.white}
        />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function BigButton({
  icon,
  label,
  color,
  rotate,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  rotate?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.bigButtonWrap}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.bigButton, { backgroundColor: color }]}>
        <Ionicons
          name={icon}
          size={32}
          color={colors.white}
          style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined}
        />
      </View>
      <Text style={styles.bigButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Fixed dark palette rather than the app theme: a call screen reads as its
  // own surface, and light mode washes the white glyphs out.
  root: { flex: 1, backgroundColor: colors.slate[900] },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
  },
  minimizeButton: { width: 32, height: 32, justifyContent: "center" },
  topBarLabel: {
    ...fontSize.xs,
    color: colors.slate[400],
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  body: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: spacing[8],
    paddingHorizontal: spacing[6],
    gap: spacing[1],
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: borderRadius.full,
    backgroundColor: colors.slate[700],
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing[5],
  },
  title: {
    ...fontSize["2xl"],
    color: colors.white,
    fontWeight: "600",
    textAlign: "center",
  },
  subtitle: { ...fontSize.base, color: colors.slate[300], textAlign: "center" },
  status: {
    ...fontSize.base,
    color: colors.slate[400],
    textAlign: "center",
    marginTop: spacing[1],
    fontVariant: ["tabular-nums"],
  },
  newCaller: {
    ...fontSize.xs,
    color: colors.amber[400],
    fontWeight: "600",
    marginTop: spacing[1],
  },
  error: {
    ...fontSize.sm,
    color: colors.red[300],
    textAlign: "center",
    marginTop: spacing[2],
  },
  keypadSection: {
    marginTop: spacing[6],
    width: "100%",
    alignItems: "center",
    gap: spacing[4],
  },
  dtmf: {
    ...fontSize.xl,
    color: colors.white,
    letterSpacing: 4,
    minHeight: 28,
    fontVariant: ["tabular-nums"],
  },
  controls: { paddingHorizontal: spacing[6], gap: spacing[6] },
  actionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing[8],
  },
  action: { alignItems: "center", gap: spacing[2] },
  actionCircle: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  actionLabel: { ...fontSize.xs, color: colors.slate[300] },
  answerRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  bigButtonWrap: { alignItems: "center", gap: spacing[2] },
  bigButton: {
    width: 68,
    height: 68,
    borderRadius: borderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  bigButtonLabel: { ...fontSize.sm, color: colors.slate[300] },
});
