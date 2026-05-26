import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
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

  const messageId =
    (typeof candidate.messageId === "string" ? candidate.messageId : undefined) ??
    (typeof (candidate as Record<string, unknown>).message_id === "string"
      ? ((candidate as Record<string, unknown>).message_id as string)
      : undefined);

  return {
    ...(candidate as Record<string, unknown>),
    type,
    ...(jobId ? { jobId } : null),
    ...(conversationId ? { conversationId } : null),
    ...(messageId ? { messageId } : null),
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
        if (!data.conversationId) return null;
        return data.messageId
          ? `/(staff)/chat/${data.conversationId}?messageId=${encodeURIComponent(
              data.messageId
            )}`
          : `/(staff)/chat/${data.conversationId}`;
    }
  }

  if (role === "customer") {
    switch (data.type) {
      case "job_update":
        return data.jobId ? `/(customer)/status/${data.jobId}` : null;
      case "new_message":
        return data.messageId
          ? `/(customer)/chat?messageId=${encodeURIComponent(data.messageId)}`
          : "/(customer)/chat";
    }
  }

  return null;
}

function routeForUniversalLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "bikeops.co" &&
      !parsed.hostname.endsWith(".bikeops.co")
    ) {
      return null;
    }
    const staffChat = parsed.pathname.match(/^\/staff\/chat\/([^/]+)/);
    if (staffChat) return `/(staff)/chat/${staffChat[1]}`;
  } catch {
    // not a valid URL
  }
  return null;
}

const FOREGROUND_REGISTER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BADGE_SYNC_INTERVAL_MS = 60 * 1000;
export const CUSTOMER_MESSAGES_QUERY_KEY = ["customerMessages"] as const;

type MessagesData =
  | ChatMessage[]
  | {
      messages: ChatMessage[];
      customerTypingAt?: string | null;
      customerLastReadAt?: string | null;
      staffLastReadAt?: string | null;
    };

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
  const queryClient = useQueryClient();
  const registered = useRef(false);
  const coldStartHandled = useRef(false);
  const lastRegisteredAt = useRef(0);
  const syncingBadge = useRef(false);
  const prefetchingChat = useRef<Record<string, boolean>>({});

  const cacheMessages = useCallback(
    (queryKey: readonly unknown[], data: MessagesData) => {
      queryClient.setQueryData<MessagesData>(queryKey, (old) => {
        const oldMessages = old
          ? Array.isArray(old)
            ? old
            : old.messages
          : [];
        const serverMessages = Array.isArray(data) ? data : data.messages ?? [];
        const oldById = new Map(oldMessages.map((m) => [m.id, m]));
        const merged = serverMessages.map((m) => {
          const previous = oldById.get(m.id);
          return previous?.clientDeliveryState
            ? { ...m, clientDeliveryState: previous.clientDeliveryState }
            : m;
        });
        const serverIds = new Set(serverMessages.map((m) => m.id));
        const optimistic = oldMessages.filter(
          (m) => m.id.startsWith("temp-") && !serverIds.has(m.id)
        );
        const messages = [...merged, ...optimistic];

        if (Array.isArray(data)) return messages;
        return { ...data, messages };
      });
    },
    [queryClient]
  );

  const prefetchChatForNotification = useCallback(
    async (data: NotificationData | null) => {
      if (!data || data.type !== "new_message" || !role) return;

      const key =
        role === "staff" && data.conversationId
          ? `staff:${data.conversationId}`
          : role === "customer"
            ? "customer"
            : null;
      if (!key || prefetchingChat.current[key]) return;

      prefetchingChat.current[key] = true;
      try {
        if (role === "staff" && data.conversationId) {
          const { data: messagesData } = await api.get<MessagesData>(
            `/api/conversations/${data.conversationId}/messages`
          );
          cacheMessages(["messages", data.conversationId], messagesData);
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
        } else if (role === "customer") {
          const { data: messagesData } = await api.get<MessagesData>(
            "/api/chat/conversation/messages",
            { role: "customer" }
          );
          cacheMessages(CUSTOMER_MESSAGES_QUERY_KEY, messagesData);
        }
      } catch {
        // Best-effort warm cache; the chat screens still fetch normally.
      } finally {
        delete prefetchingChat.current[key];
      }
    },
    [cacheMessages, queryClient, role]
  );

  const prefetchPresentedChatNotifications = useCallback(async () => {
    try {
      const notifications = await Notifications.getPresentedNotificationsAsync();
      await Promise.all(
        notifications.map((notification) =>
          prefetchChatForNotification(
            normalizeNotificationData(notification.request.content.data)
          )
        )
      );
    } catch {
      // Not available on every platform/version; normal screen fetches remain.
    }
  }, [prefetchChatForNotification]);

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
        prefetchPresentedChatNotifications();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [role, syncBadgeCount, prefetchPresentedChatNotifications]);

  useEffect(() => {
    if (!role) return;
    syncBadgeCount();
    prefetchPresentedChatNotifications();
    const id = setInterval(syncBadgeCount, BADGE_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [role, syncBadgeCount, prefetchPresentedChatNotifications]);

  // Handle cold-start: the app was launched by tapping a notification while it
  // was killed or suspended. The response listener below won't fire in that case
  // because it isn't registered yet when Expo delivers the tap event, so we
  // must explicitly fetch it once the role (and router) are ready.
  useEffect(() => {
    if (!role || coldStartHandled.current) return;
    coldStartHandled.current = true;

    Notifications.getLastNotificationResponseAsync().then(async (response) => {
      if (!response) return;
      const raw = response.notification.request.content.data;
      const data = normalizeNotificationData(raw);
      const route = data ? routeForNotification(data, role) : null;
      await prefetchChatForNotification(data);
      if (route) {
        // Use replace so the index Redirect can't "win" and leave you on the job board.
        setTimeout(() => router.replace(route as never), 0);
      }
    });
  }, [role, router, prefetchChatForNotification]);

  // Handle universal links (https://bikeops.co/staff/chat/:id) so the email
  // "Open staff chat" button opens the app instead of the browser.
  useEffect(() => {
    if (role !== "staff") return;

    const handleUrl = ({ url }: { url: string }) => {
      const route = routeForUniversalLink(url);
      if (route) router.replace(route as never);
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, [role, router]);

  useEffect(() => {
    if (!role) return;

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(async (response) => {
        const raw = response.notification.request.content.data;
        const data = normalizeNotificationData(raw);
        const route = data ? routeForNotification(data, role) : null;
        syncBadgeCount();
        await prefetchChatForNotification(data);
        if (route) {
          router.replace(route as never);
        }
      });

    return () => responseSubscription.remove();
  }, [role, router, syncBadgeCount, prefetchChatForNotification]);

  useEffect(() => {
    if (!role) return;

    const receivedSubscription =
      Notifications.addNotificationReceivedListener((notification) => {
        // Notification received while app is foregrounded.
        // The notification handler in notifications.ts will display it.
        prefetchChatForNotification(
          normalizeNotificationData(notification.request.content.data)
        );
        syncBadgeCount();
      });

    return () => receivedSubscription.remove();
  }, [role, syncBadgeCount, prefetchChatForNotification]);
}
