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
import {
  normalizeNotificationData,
  routeForNotification,
  routeForUniversalLink,
} from "@/lib/notification-routing";
import { api } from "@/lib/api";
import { type ChatMessage, type Conversation, type Job } from "@/lib/types";

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
  const coldStartPrefetchDone = useRef(false);
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

  // Warm the message cache on cold start (navigation is handled in app/index.tsx).
  useEffect(() => {
    if (!role || coldStartPrefetchDone.current) return;
    coldStartPrefetchDone.current = true;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = normalizeNotificationData(
        response.notification.request.content.data
      );
      void prefetchChatForNotification(data);
    });
  }, [role, prefetchChatForNotification]);

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
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = normalizeNotificationData(
          response.notification.request.content.data
        );
        const route = data ? routeForNotification(data, role) : null;
        syncBadgeCount();
        if (route) {
          router.replace(route as never);
        }
        void prefetchChatForNotification(data);
      });

    return () => responseSubscription.remove();
  }, [role, router, syncBadgeCount, prefetchChatForNotification]);

  useEffect(() => {
    if (!role) return;

    const receivedSubscription =
      Notifications.addNotificationReceivedListener((notification) => {
        prefetchChatForNotification(
          normalizeNotificationData(notification.request.content.data)
        );
        syncBadgeCount();
      });

    return () => receivedSubscription.remove();
  }, [role, syncBadgeCount, prefetchChatForNotification]);
}
