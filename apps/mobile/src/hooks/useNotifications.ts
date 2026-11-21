import { useCallback, useEffect, useRef } from "react";
import {
  AppState,
  InteractionManager,
  type AppStateStatus,
  Linking,
} from "react-native";
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
  captureBookingDigestFromNotification,
  normalizeNotificationData,
  routeForNotification,
  routeForUniversalLink,
} from "@/lib/notification-routing";
import {
  CUSTOMER_MESSAGES_QUERY_KEY,
  prefetchChatForNotification,
} from "@/lib/chat-notification-prefetch";
import {
  conversationsQueryKey,
  fetchStaffConversations,
  fetchStaffJobs,
  jobsQueryKey,
  prefetchStaffHomeData,
} from "@/lib/staff-queries";
import { type Conversation } from "@/lib/types";
import type { QueryClient } from "@tanstack/react-query";

export { CUSTOMER_MESSAGES_QUERY_KEY };

const FOREGROUND_REGISTER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BADGE_SYNC_INTERVAL_MS = 60 * 1000;

function lastConversationMessage(conv: Conversation) {
  if (!conv.messages || conv.messages.length === 0) return null;
  return conv.messages[0] ?? null;
}

function hasUnreadStaffMessage(conv: Conversation): boolean {
  const lastMsg = lastConversationMessage(conv);
  if (!lastMsg || lastMsg.sender !== "CUSTOMER") return false;
  if (!conv.staffLastReadAt) return true;
  return new Date(lastMsg.createdAt) > new Date(conv.staffLastReadAt);
}

async function getStaffBadgeCount(queryClient: QueryClient): Promise<number> {
  const [conversationsResult, jobsResult] = await Promise.allSettled([
    queryClient.fetchQuery({
      queryKey: conversationsQueryKey,
      queryFn: fetchStaffConversations,
    }),
    queryClient.fetchQuery({
      queryKey: jobsQueryKey,
      queryFn: fetchStaffJobs,
    }),
  ]);

  const unreadConversations =
    conversationsResult.status === "fulfilled"
      ? conversationsResult.value.filter(hasUnreadStaffMessage).length
      : 0;
  const pendingApprovals =
    jobsResult.status === "fulfilled"
      ? jobsResult.value.filter((job) => job.stage === "PENDING_APPROVAL").length
      : 0;

  return unreadConversations + pendingApprovals;
}

export function useNotifications() {
  const { role } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const registeredForRole = useRef<typeof role>(null);
  const coldStartPrefetchDone = useRef(false);
  const lastRegisteredAt = useRef(0);
  const syncingBadge = useRef(false);

  const warmChatFromNotification = useCallback(
    async (data: NotificationData | null, body?: string | null) => {
      if (!data || !role) return;
      await prefetchChatForNotification(queryClient, role, data, { body });
    },
    [queryClient, role]
  );

  const prefetchPresentedChatNotifications = useCallback(async () => {
    try {
      const notifications = await Notifications.getPresentedNotificationsAsync();
      await Promise.all(
        notifications.map((notification) =>
          warmChatFromNotification(
            normalizeNotificationData(notification.request.content.data),
            notification.request.content.body ?? null
          )
        )
      );
    } catch {
      // Not available on every platform/version; normal screen fetches remain.
    }
  }, [warmChatFromNotification]);

  const syncBadgeCount = useCallback(async () => {
    if (syncingBadge.current) return;
    syncingBadge.current = true;
    try {
      if (role === "staff") {
        await setBadgeCount(await getStaffBadgeCount(queryClient));
      } else if (role === "customer") {
        await setBadgeCount(0);
      } else {
        await setBadgeCount(0);
      }
    } finally {
      syncingBadge.current = false;
    }
  }, [role, queryClient]);

  useEffect(() => {
    if (!role) {
      registeredForRole.current = null;
      lastRegisteredAt.current = 0;
      setBadgeCount(0);
      return;
    }
    if (registeredForRole.current === role) return;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      registerForPushNotifications(role).then((token) => {
        if (cancelled) return;
        if (token) {
          registeredForRole.current = role;
          lastRegisteredAt.current = Date.now();
        }
      });
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [role]);

  useEffect(() => {
    if (!role) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        const now = Date.now();
        if (
          registeredForRole.current !== role ||
          now - lastRegisteredAt.current > FOREGROUND_REGISTER_INTERVAL_MS
        ) {
          lastRegisteredAt.current = now;
          registerForPushNotifications(role).then((token) => {
            if (token) registeredForRole.current = role;
          });
        }
        syncBadgeCount();
        prefetchPresentedChatNotifications();
        if (role === "customer") {
          queryClient.invalidateQueries({ queryKey: ["customer-jobs"] });
          queryClient.invalidateQueries({ queryKey: ["job-status"] });
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [role, queryClient, syncBadgeCount, prefetchPresentedChatNotifications]);

  useEffect(() => {
    if (!role) return;
    const task = InteractionManager.runAfterInteractions(() => {
      syncBadgeCount();
      prefetchPresentedChatNotifications();
    });
    const id = setInterval(syncBadgeCount, BADGE_SYNC_INTERVAL_MS);
    return () => {
      task.cancel();
      clearInterval(id);
    };
  }, [role, syncBadgeCount, prefetchPresentedChatNotifications]);

  useEffect(() => {
    if (!role || coldStartPrefetchDone.current) return;
    coldStartPrefetchDone.current = true;

    if (role === "staff") {
      void prefetchStaffHomeData(queryClient);
    }

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      void warmChatFromNotification(
        normalizeNotificationData(response.notification.request.content.data),
        response.notification.request.content.body ?? null
      );
    });
  }, [role, warmChatFromNotification, queryClient]);

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
        if (captureBookingDigestFromNotification(data)) {
          void Notifications.clearLastNotificationResponseAsync();
        }
        const route = data ? routeForNotification(data, role) : null;
        syncBadgeCount();
        void (async () => {
          await warmChatFromNotification(
            data,
            response.notification.request.content.body ?? null
          );
          if (route) {
            router.replace(route as never);
          }
        })();
      });

    return () => responseSubscription.remove();
  }, [role, router, syncBadgeCount, warmChatFromNotification]);

  useEffect(() => {
    if (!role) return;

    const receivedSubscription =
      Notifications.addNotificationReceivedListener((notification) => {
        const data = normalizeNotificationData(
          notification.request.content.data
        );
        void warmChatFromNotification(
          data,
          notification.request.content.body ?? null
        );
        syncBadgeCount();
        if (
          role === "customer" &&
          (data?.type === "job_update" || data?.type === "new_message")
        ) {
          queryClient.invalidateQueries({ queryKey: ["customer-jobs"] });
          queryClient.invalidateQueries({
            queryKey: data.jobId ? ["job-status", data.jobId] : ["job-status"],
          });
        }
      });

    return () => receivedSubscription.remove();
  }, [role, queryClient, syncBadgeCount, warmChatFromNotification]);
}
