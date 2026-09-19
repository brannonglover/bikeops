import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api, type AuthRole } from "./api";

/**
 * The ringtone bundled into the binary by the expo-notifications config
 * plugin, so a call is recognisable as this shop's across a workshop rather
 * than sounding like every other phone in the room. Which tone it holds is a
 * matter of taste and changes by regenerating the file in place — see
 * assets/sounds/incoming_call.py.
 *
 * Despite living here, this is now CallKit's ringtone rather than a
 * notification sound: inbound calls ring as real calls, not notifications.
 * The config plugin is simply what puts the file in the iOS bundle, which is
 * where CallKit looks it up by name — see configureCallKit in lib/voice.
 */
export const INCOMING_CALL_SOUND = "incoming_call.wav";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // A ringing call is CallKit's now, not a notification, so nothing here
    // needs suppressing — a "Missed call" is an ordinary notification and
    // should behave like one.
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
  },
});

export type NotificationType =
  | "new_job"
  | "job_update"
  | "new_message"
  | "booking_request"
  | "staff_booking_digest"
  // Raised by the server once a call has finished ringing unanswered. The ring
  // itself is CallKit's — see lib/voice.ts — so this is a record of a call
  // that was missed, never an attempt to announce one in progress.
  | "missed_call";

export interface NotificationData {
  type: NotificationType;
  jobId?: string;
  conversationId?: string;
  messageId?: string;
  /** missed_call: server-side Call id of the call that went unanswered. */
  callId?: string;
  /** missed_call: caller's number in E.164. */
  from?: string;
  /** missed_call: customer name when the number is a known customer. */
  customerName?: string | null;
  todayJobIds?: string[] | string;
  tomorrowJobIds?: string[] | string;
  [key: string]: unknown;
}

async function getExpoPushToken(): Promise<string | null> {
  try {
    // easConfig.projectId is injected automatically by EAS builds.
    // extra.eas.projectId is the manual fallback for local/custom builds.
    const projectId =
      Constants.easConfig?.projectId ??
      Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn("[Push] No EAS projectId found — token will not be obtained. Check EAS_PROJECT_ID env and app.config.ts.");
    }
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (err) {
    console.warn("[Push] getExpoPushTokenAsync failed:", err);
    return null;
  }
}

export async function registerForPushNotifications(
  role: AuthRole
): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device");
    return null;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted" || Platform.OS === "ios") {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("[Push] Permission not granted — status:", finalStatus);
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      showBadge: true,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#f59e0b",
    });
  }

  const token = await getExpoPushToken();
  if (!token) {
    console.warn("[Push] No token returned — skipping server registration");
    return null;
  }

  try {
    await api.post(
      "/api/push-tokens",
      { token, platform: Platform.OS },
      { role: role ?? "staff" }
    );
    console.log("[Push] Token registered with server successfully");
  } catch (err) {
    console.warn("[Push] Failed to register push token with server:", err);
    return null;
  }

  return token;
}

export async function unregisterPushToken(
  role: AuthRole,
  options?: { cookie?: string | null }
): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (token) {
      await api.delete(`/api/push-tokens?token=${encodeURIComponent(token)}`, {
        role: role ?? "staff",
        ...(options?.cookie
          ? { cookie: options.cookie, persistSession: false }
          : {}),
      });
    }
  } catch {
    // Best-effort cleanup
  }
}

export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Not all platforms support badge counts
  }
}
