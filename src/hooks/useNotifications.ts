import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import {
  registerForPushNotifications,
  type NotificationData,
} from "@/lib/notifications";

function routeForNotification(
  data: NotificationData,
  role: "staff" | "customer"
): string | null {
  if (!data?.type) return null;

  if (role === "staff") {
    switch (data.type) {
      case "new_job":
      case "job_update":
      case "booking_request":
        return data.jobId ? `/(staff)/(jobs)/${data.jobId}` : null;
      case "new_message":
        return data.conversationId
          ? `/(staff)/chat/${data.conversationId}`
          : null;
    }
  }

  if (role === "customer") {
    switch (data.type) {
      case "job_update":
        return data.jobId ? `/(customer)/status/${data.jobId}` : null;
      case "new_message":
        return "/(customer)/chat";
    }
  }

  return null;
}

export function useNotifications() {
  const { role } = useAuth();
  const router = useRouter();
  const registered = useRef(false);

  useEffect(() => {
    if (!role || registered.current) return;
    registered.current = true;
    registerForPushNotifications(role);
  }, [role]);

  useEffect(() => {
    if (!role) return;

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content
          .data as NotificationData;
        const route = routeForNotification(data, role);
        if (route) {
          router.push(route as never);
        }
      });

    return () => responseSubscription.remove();
  }, [role, router]);

  useEffect(() => {
    if (!role) return;

    const receivedSubscription =
      Notifications.addNotificationReceivedListener(() => {
        // Notification received while app is foregrounded.
        // The notification handler in notifications.ts will display it.
      });

    return () => receivedSubscription.remove();
  }, [role]);
}
