import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import {
  registerForPushNotifications,
  setBadgeCount,
  type NotificationData,
} from "@/lib/notifications";
import { api } from "@/lib/api";
import { type ChatMessage, type Conversation, type Job } from "@/lib/types";

function normalizeNotificationData(raw: unknown): NotificationData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  let candidate: Record<string, unknown> = obj;
  if (obj.data && typeof obj.data === "object") candidate = obj.data as Record<string, unknown>;
  if (obj.data && typeof obj.data === "string") {
    try {
      const parsed = JSON.parse(obj.data);
      if (parsed && typeof parsed === "object") candidate = parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  const rawType = candidate.type ?? obj.type;
  if (typeof rawType !== "string" || rawType.length === 0) return null;
  const type = rawType.toLowerCase() as NotificationData["type"];

  const jobId =
    (typeof candidate.jobId === "string" ? candidate.jobId : undefined) ??
    (typeof (candidate as Record<string, unknown>).job_id === "string"
      ? ((candidate as Record<string, unknown>).job_id as string)
      : undefined);

  const conversationId =
    (typeof candidate.conversationId === "string" ? candidate.conversationId : undefined) ??
    (typeof (candidate as Record<string, unknown>).conversation_id === "string"
      ? ((candidate as Record<string, unknown>).conversation_id as string)
      : undefined);

  return {
    ...(candidate as Record<string, unknown>),
    type,
    ...(jobId ? { jobId } : null),
    ...(conversationId ? { conversationId } : null),
  } as NotificationData;
}

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

const FOREGROUND_REGISTER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BADGE_SYNC_INTERVAL_MS = 60 * 1000;

function lastConversationMessage(conv: Conversation): ChatMessage | null {
  if (!conv.messages || conv.messages.length === 0) return null;
  return conv.messages[conv.messages.length - 1] ?? null;
}

function hasUnreadStaffMessage(conv: Conversation): boolean {
  const lastMsg = lastConversationMessage(conv);
  if (!lastMsg || lastMsg.sender !== "CUSTOMER") return false;
  if (!conv.staffLastReadAt) return true;
  return new Date(lastMsg.createdAt) > new Date(conv.staffLastReadAt);
}

async function getStaffBadgeCount(): Promise<number> {
  const [conversationsResult, jobsResult] = await Promise.allSettled([
    api.get<Conversation[]>("/api/conversations"),
    api.get<Job[]>("/api/jobs"),
  ]);

  const unreadConversations =
    conversationsResult.status === "fulfilled"
      ? conversationsResult.value.data.filter(hasUnreadStaffMessage).length
      : 0;
  const pendingApprovals =
    jobsResult.status === "fulfilled"
      ? jobsResult.value.data.filter((job) => job.stage === "PENDING_APPROVAL").length
      : 0;

  return unreadConversations + pendingApprovals;
}

export function useNotifications() {
  const { role } = useAuth();
  const router = useRouter();
  const registered = useRef(false);
  const coldStartHandled = useRef(false);
  const lastRegisteredAt = useRef(0);
  const syncingBadge = useRef(false);

  const syncBadgeCount = useCallback(async () => {
    if (syncingBadge.current) return;
    syncingBadge.current = true;
    try {
      if (role === "staff") {
        await setBadgeCount(await getStaffBadgeCount());
      } else if (role === "customer") {
        await setBadgeCount(0);
      } else {
        await setBadgeCount(0);
      }
    } finally {
      syncingBadge.current = false;
    }
  }, [role]);

  useEffect(() => {
    if (!role) {
      registered.current = false;
      lastRegisteredAt.current = 0;
      setBadgeCount(0);
      return;
    }
    if (registered.current) return;
    registerForPushNotifications(role).then((token) => {
      if (token) {
        registered.current = true;
        lastRegisteredAt.current = Date.now();
      }
    });
  }, [role]);

  // Re-register when the app returns to the foreground to recover from a
  // first-launch failure, but throttled to at most once per hour so it
  // doesn't spike work every time the user switches apps.
  useEffect(() => {
    if (!role) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        const now = Date.now();
        if (now - lastRegisteredAt.current > FOREGROUND_REGISTER_INTERVAL_MS) {
          lastRegisteredAt.current = now;
          registerForPushNotifications(role);
        }
        syncBadgeCount();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [role, syncBadgeCount]);

  useEffect(() => {
    if (!role) return;
    syncBadgeCount();
    const id = setInterval(syncBadgeCount, BADGE_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [role, syncBadgeCount]);

  // Handle cold-start: the app was launched by tapping a notification while it
  // was killed or suspended. The response listener below won't fire in that case
  // because it isn't registered yet when Expo delivers the tap event, so we
  // must explicitly fetch it once the role (and router) are ready.
  useEffect(() => {
    if (!role || coldStartHandled.current) return;
    coldStartHandled.current = true;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const raw = response.notification.request.content.data;
      const data = normalizeNotificationData(raw);
      const route = data ? routeForNotification(data, role) : null;
      if (route) {
        // Use replace so the index Redirect can't "win" and leave you on the job board.
        setTimeout(() => router.replace(route as never), 0);
      }
    });
  }, [role, router]);

  useEffect(() => {
    if (!role) return;

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const raw = response.notification.request.content.data;
        const data = normalizeNotificationData(raw);
        const route = data ? routeForNotification(data, role) : null;
        syncBadgeCount();
        if (route) {
          router.replace(route as never);
        }
      });

    return () => responseSubscription.remove();
  }, [role, router, syncBadgeCount]);

  useEffect(() => {
    if (!role) return;

    const receivedSubscription =
      Notifications.addNotificationReceivedListener(() => {
        // Notification received while app is foregrounded.
        // The notification handler in notifications.ts will display it.
        syncBadgeCount();
      });

    return () => receivedSubscription.remove();
  }, [role, syncBadgeCount]);
}
