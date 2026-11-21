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
 * iOS takes it by filename on the notification itself; Android takes it on the
 * channel below. Both resolve it by base name, so renaming the asset means
 * renaming it in all three places.
 */
export const INCOMING_CALL_SOUND = "incoming_call.wav";

/**
 * Android puts sound and importance on the channel, not the notification, and
 * a channel's settings are frozen the moment it is first created — later
 * createNotificationChannel calls with the same id are ignored, and deleting
 * one only makes Android remember its old settings for the next time. So
 * changing the ring means bumping this suffix, not editing the channel.
 *
 * The server names this channel on the call push. A notification sent to a
 * channel the device has not created yet is dropped silently, so the app build
 * that creates it has to reach staff devices before the server starts asking
 * for it.
 */
export const INCOMING_CALL_CHANNEL_ID = "incoming_call_v1";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // An incoming call already raises the full call screen when the app is
    // open, so its banner would just cover the answer button.
    const isCall =
      (notification.request.content.data as { type?: unknown } | null)?.type ===
      "incoming_call";
    // Silent and invisible for a call, because by the time the app is in the
    // foreground the call screen is already up and answering is one tap away.
    // The server keeps re-sending this every few seconds for as long as the
    // caller holds — that repeat is the ring — so letting each one through
    // would keep alerting someone who is already looking at the call.
    return {
      shouldShowBanner: !isCall,
      shouldShowList: !isCall,
      shouldPlaySound: !isCall,
      shouldSetBadge: !isCall,
    };
  },
});

export type NotificationType =
  | "new_job"
  | "job_update"
  | "new_message"
  | "booking_request"
  | "staff_booking_digest"
  // The ring for an inbound call. This app does not use PushKit, so an
  // ordinary notification is what wakes the device for a call — see
  // lib/voice.ts and the CallScreen.
  | "incoming_call";

export interface NotificationData {
  type: NotificationType;
  jobId?: string;
  conversationId?: string;
  messageId?: string;
  /** incoming_call: server-side Call id, used to answer or decline. */
  callId?: string;
  /** incoming_call: caller's number in E.164. */
  from?: string;
  /** incoming_call: customer name when the number is a known customer. */
  customerName?: string | null;
  /**
   * incoming_call: ISO timestamp at which the caller stops holding and is sent
   * to voicemail. Sent with every repeat of the ring, so it stays the caller's
   * deadline rather than this device's.
   */
  ringEndsAt?: string | null;
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

    // Calls get their own channel so they can ring rather than chime, and so
    // staff can turn shop notifications down in Android settings without also
    // silencing the phone. NOTIFICATION_RINGTONE routes the tone through the
    // ring stream, so it follows ring volume the way a call should rather than
    // notification volume. The vibration is one pulse over the strike and then
    // a long gap, matching the tone's 4s cadence without assuming how many
    // notes the current voicing has.
    //
    // Only staff take shop calls, so a customer's phone never gets this
    // channel cluttering its notification settings.
    if (role === "staff") {
      await Notifications.setNotificationChannelAsync(INCOMING_CALL_CHANNEL_ID, {
        name: "Incoming calls",
        description: "Rings when a customer calls the shop.",
        importance: Notifications.AndroidImportance.MAX,
        sound: INCOMING_CALL_SOUND,
        audioAttributes: {
          usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
        enableVibrate: true,
        vibrationPattern: [0, 500, 3500],
        lightColor: "#f59e0b",
        showBadge: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
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
