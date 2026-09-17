import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Pressable, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useCallManager, type CallState } from "@/hooks/useCallManager";
import { useAuth } from "@/lib/auth";
import { normalizeNotificationData } from "@/lib/notification-routing";
import { useTheme } from "@/lib/ThemeContext";
import { formatPhoneNumber } from "@/lib/format";
import { CallScreen } from "@/components/calls/CallScreen";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";

export type RegistrationState = {
  status: "idle" | "registering" | "registered" | "failed";
  error: string | null;
};

/**
 * A notification older than this is from a call that has already timed out to
 * voicemail, so tapping it should not raise a ringing screen for a caller who
 * is no longer there. Comfortably longer than the server's ring window.
 */
const CALL_NOTIFICATION_TTL_MS = 45_000;

type CallContextValue = {
  state: CallState;
  /**
   * Whether this device can actually receive inbound calls. Inbound calls ring
   * via ordinary push notifications, so notification permission is the whole
   * requirement — no Twilio-side registration is involved.
   */
  registration: RegistrationState;
  startCall: (toNumber: string, displayName?: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  sendDigits: (digits: string) => Promise<void>;
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
  reconnecting: "Reconnecting…",
  disconnected: "Call ended",
  failed: "Call failed",
};

/**
 * The call reduced to a status strip, for when staff minimize the call screen
 * to look something up mid-call. Tapping it brings the full screen back.
 */
function CallBanner({
  state,
  acceptIncoming,
  rejectIncoming,
  hangUp,
  onExpand,
}: {
  state: CallState;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  hangUp: () => Promise<void>;
  onExpand: () => void;
}) {
  useTheme();

  if (state.status === "idle") return null;

  const isIncoming = state.status === "incoming";
  const title =
    state.displayName ?? (state.number ? formatPhoneNumber(state.number) : "Unknown caller");

  return (
    <Pressable
      onPress={onExpand}
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
      accessibilityRole="button"
      accessibilityLabel="Return to call"
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

      {/* A minimized call that is still ringing needs answer/decline here —
          hangUp only disconnects an established call, so it would be inert. */}
      {isIncoming ? (
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          <Pressable
            onPress={() => void rejectIncoming()}
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
            onPress={() => void acceptIncoming()}
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
      ) : (
        <Pressable
          onPress={() => void hangUp()}
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
      )}
    </Pressable>
  );
}

/**
 * Pulls the call details out of a notification, or null if it isn't one.
 */
function incomingCallFromNotification(
  notification: Notifications.Notification
): { callId: string; number: string; displayName: string | null } | null {
  const data = normalizeNotificationData(notification.request.content.data);
  if (!data || data.type !== "incoming_call") return null;
  if (typeof data.callId !== "string" || typeof data.from !== "string") return null;

  return {
    callId: data.callId,
    number: data.from,
    displayName: typeof data.customerName === "string" ? data.customerName : null,
  };
}

/**
 * Age of a notification in milliseconds, or null when it can't be determined.
 *
 * `date` is not one unit across platforms: iOS serializes
 * timeIntervalSince1970 (SECONDS), Android getTime() (milliseconds). Comparing
 * the iOS value against Date.now() directly makes every notification look
 * decades old — which silently swallowed every inbound call until this was
 * normalized. Anything below the year-2001-in-milliseconds mark has to be
 * seconds, since as milliseconds it would predate the product by decades.
 */
function notificationAgeMs(notification: Notifications.Notification): number | null {
  const raw: unknown = notification.date;
  const value = raw instanceof Date ? raw.getTime() : typeof raw === "number" ? raw : null;
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const millis = value < 1e12 ? value * 1000 : value;
  return Date.now() - millis;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const {
    state,
    startCall,
    presentIncomingCall,
    acceptIncoming,
    rejectIncoming,
    hangUp,
    toggleMute,
    toggleSpeaker,
    sendDigits,
  } = useCallManager();
  const { staffUser } = useAuth();
  const [registration, setRegistration] = useState<RegistrationState>({
    status: "idle",
    error: null,
  });

  // The full call screen is the default; minimizing trades it for the banner.
  const [minimized, setMinimized] = useState(false);

  // Every new call opens full-screen, however the last one was left.
  useEffect(() => {
    if (state.status === "incoming" || state.status === "connecting") {
      setMinimized(false);
    }
  }, [state.status]);

  const minimize = useCallback(() => setMinimized(true), []);
  const expand = useCallback(() => setMinimized(false), []);

  /**
   * Notification permission is what decides whether calls ring on this device
   * now that inbound calls no longer use a Twilio push registration. Rechecked
   * on foreground because permission can be revoked from Settings at any time.
   */
  useEffect(() => {
    if (!staffUser) {
      setRegistration({ status: "idle", error: null });
      return;
    }

    let cancelled = false;

    const check = async () => {
      setRegistration((prev) => ({ status: "registering", error: prev.error }));
      try {
        const { granted } = await Notifications.getPermissionsAsync();
        if (cancelled) return;
        setRegistration(
          granted
            ? { status: "registered", error: null }
            : {
                status: "failed",
                error: "Notifications are off, so calls can't ring this device",
              }
        );
      } catch (error) {
        if (cancelled) return;
        setRegistration({
          status: "failed",
          error: error instanceof Error ? error.message : "Could not check notifications",
        });
      }
    };

    void check();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [staffUser]);

  // Inbound calls arrive as notifications rather than Twilio invites, so the
  // ring is wired up here rather than in useNotifications — CallProvider sits
  // inside NotificationProvider and so can't reach back up to it.
  useEffect(() => {
    if (!staffUser) return;

    const present = (notification: Notifications.Notification) => {
      const incoming = incomingCallFromNotification(notification);
      if (incoming) presentIncomingCall(incoming);
    };

    // Live events need no freshness check — they are happening right now.
    // Arrived while the app is open: ring immediately rather than show a
    // banner the user then has to tap.
    const received = Notifications.addNotificationReceivedListener(present);
    // Tapped from the background or lock screen.
    const responded = Notifications.addNotificationResponseReceivedListener((response) =>
      present(response.notification)
    );

    // Cold start replays the tap that launched the app — and keeps replaying it
    // on every later launch until something clears it, so this is the one path
    // that must not ring for a call that is long over. An unreadable age fails
    // open: a spurious ring is cheaper than a missed customer.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const age = notificationAgeMs(response.notification);
      if (age !== null && age > CALL_NOTIFICATION_TTL_MS) return;
      present(response.notification);
    });

    return () => {
      received.remove();
      responded.remove();
    };
  }, [staffUser, presentIncomingCall]);

  // Clear the "Incoming call" notification once the call is no longer ringing,
  // so a handled call doesn't sit in the notification shade.
  useEffect(() => {
    if (state.status === "incoming" || state.status === "idle") return;
    void Notifications.getPresentedNotificationsAsync()
      .then((presented) =>
        Promise.all(
          presented
            .filter(
              (n) =>
                normalizeNotificationData(n.request.content.data)?.type === "incoming_call"
            )
            .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
        )
      )
      .catch(() => {
        // Tray cleanup is cosmetic; not worth surfacing a failure.
      });
  }, [state.status]);

  const value: CallContextValue = {
    state,
    registration,
    startCall,
    acceptIncoming,
    rejectIncoming,
    hangUp,
    toggleMute,
    toggleSpeaker,
    sendDigits,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      {minimized ? (
        <CallBanner
          state={state}
          acceptIncoming={acceptIncoming}
          rejectIncoming={rejectIncoming}
          hangUp={hangUp}
          onExpand={expand}
        />
      ) : (
        <CallScreen
          state={state}
          acceptIncoming={acceptIncoming}
          rejectIncoming={rejectIncoming}
          hangUp={hangUp}
          toggleMute={toggleMute}
          toggleSpeaker={toggleSpeaker}
          sendDigits={sendDigits}
          onMinimize={minimize}
        />
      )}
    </CallContext.Provider>
  );
}
