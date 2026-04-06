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
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
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

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#f59e0b",
    });
  }

  const token = await getExpoPushToken();
  if (!token) return null;

  try {
    await api.post(
      "/api/push-tokens",
      { token, platform: Platform.OS },
      { role: role ?? "staff" }
    );
  } catch (err) {
    console.warn("Failed to register push token with server:", err);
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
