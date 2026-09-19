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
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import type { CallInvite } from "@twilio/voice-react-native-sdk";
import { callProgressLabel, useCallManager, type CallState } from "@/hooks/useCallManager";
import { callsQueryKey } from "@/lib/staff-queries";
import { useAuth } from "@/lib/auth";
import {
  configureCallKit,
  getPendingCallInvites,
  initializePushRegistry,
  onCallInvite,
  registerForVoicePush,
} from "@/lib/voice";
import { useTheme } from "@/lib/ThemeContext";
import { formatPhoneNumber } from "@/lib/format";
import { CallScreen } from "@/components/calls/CallScreen";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";

export type RegistrationState = {
  status: "idle" | "registering" | "registered" | "failed";
  error: string | null;
};

type CallContextValue = {
  state: CallState;
  /**
   * Whether this device can actually receive inbound calls — that is, whether
   * Twilio has a live registration for it and will send a VoIP push. Nothing
   * to do with notification permission any more: CallKit rings regardless of
   * it, and a device that is merely unregistered rings not at all.
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
          {state.status === "connected" ? "On call" : callProgressLabel(state)}
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
  const queryClient = useQueryClient();
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

  /**
   * Refresh the call log the moment a call finishes, so the row that was "In
   * progress" a second ago reads "Answered" instead of waiting out the list's
   * 15s poll.
   *
   * Twice, because the outcome isn't ours to decide: answeredAt and the final
   * status arrive from Twilio's status callback, which can land just after we
   * hang up. The first refetch usually wins; the delayed one covers the race.
   */
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const active =
      state.status === "connected" ||
      state.status === "reconnecting" ||
      state.status === "connecting" ||
      state.status === "ringing";

    if (active) {
      wasActiveRef.current = true;
      return;
    }
    if (!wasActiveRef.current || state.status !== "idle") return;
    wasActiveRef.current = false;

    void queryClient.invalidateQueries({ queryKey: callsQueryKey });
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: callsQueryKey });
    }, 2_500);
    return () => clearTimeout(timer);
  }, [state.status, queryClient]);

  const minimize = useCallback(() => setMinimized(true), []);
  const expand = useCallback(() => setMinimized(false), []);

  // Both have to be in place before any call, inbound or out, and neither is
  // tied to the staff session — the VoIP push can arrive before the app has
  // finished restoring one. Configuring CallKit late would mean the first call
  // of a launch ringing with the system tone instead of the shop's.
  useEffect(() => {
    void initializePushRegistry().catch((error) => {
      console.warn("[voice] PushKit registry init failed:", error);
    });
    void configureCallKit().catch((error) => {
      console.warn("[voice] CallKit configuration failed:", error);
    });
  }, []);

  /**
   * Registers this device with Twilio so inbound calls ring it.
   *
   * Repeated on every foreground rather than once at sign in: a registration
   * is tied to the access token that made it and lapses with it, and a device
   * that has quietly stopped being rung looks exactly like one nobody has
   * called. Re-registering with a fresh token is cheap and idempotent.
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
        await registerForVoicePush();
        if (cancelled) return;
        setRegistration({ status: "registered", error: null });
      } catch (error) {
        if (cancelled) return;
        setRegistration({
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "This device isn't registered, so calls can't ring it",
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

  // Mirror a ringing invite into the app's own UI. CallKit is already ringing
  // the phone by the time this fires — iOS requires the SDK to report the VoIP
  // push within milliseconds — so none of this starts or stops the ring. It
  // only decides what staff see if they open the app while it rings.
  useEffect(() => {
    const present = (invite: CallInvite) => {
      const from = invite.getFrom();
      // The server passes the customer's name and our Call id as custom
      // parameters on the invite, so the screen can name the caller without a
      // round trip while the phone is still ringing.
      const custom = invite.getCustomParameters() ?? {};
      const displayName = custom.customerName || null;

      // The CallKit screen defaults to the raw SIP identity, which reads as
      // gibberish. This is the only chance to correct it — once the screen is
      // up it is the system's, and a customer's name is the whole reason to
      // glance at a ringing phone.
      if (displayName) {
        void invite.updateCallerHandle(displayName).catch(() => {
          // Cosmetic: the call still rings, just labelled less helpfully.
        });
      }

      presentIncomingCall({
        invite,
        number: from,
        displayName,
        callId: custom.callId || null,
      });
    };

    const unsubscribe = onCallInvite(present);

    // Launching into a call that is already ringing: the SDK hands over any
    // invite it is still holding, which a listener registered after the push
    // would otherwise miss entirely.
    void getPendingCallInvites().then((invites) => {
      const [pending] = invites;
      if (pending) present(pending);
    });

    return unsubscribe;
  }, [presentIncomingCall]);

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
