import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api, type AuthRole } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type NotificationType =
  | "new_job"
  | "job_update"
  | "new_message"
  | "booking_request";

export interface NotificationData {
  type: NotificationType;
  jobId?: string;
  conversationId?: string;
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

export async function unregisterPushToken(role: AuthRole): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (token) {
      await api.delete(`/api/push-tokens?token=${encodeURIComponent(token)}`, {
        role: role ?? "staff",
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
