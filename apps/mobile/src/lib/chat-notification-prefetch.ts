import type { QueryClient } from "@tanstack/react-query";
import { api, warmCustomerRequestCredentials, warmStaffRequestCredentials } from "@/lib/api";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  customerMessagesPath,
  staffMessagesPath,
} from "@/lib/chat-messages";
import type { NotificationData } from "@/lib/notifications";
import { conversationsQueryKey, fetchStaffConversations } from "@/lib/staff-queries";
import { type ChatMessage, type Conversation } from "@/lib/types";

export const CUSTOMER_MESSAGES_QUERY_KEY = ["customerMessages"] as const;

export type MessagesData =
  | ChatMessage[]
  | {
      messages: ChatMessage[];
      customerTypingAt?: string | null;
      customerLastReadAt?: string | null;
      staffLastReadAt?: string | null;
      hasMore?: boolean;
    };

function latestConversationMessage(conv: Conversation): ChatMessage | null {
  if (!conv.messages || conv.messages.length === 0) return null;
  return conv.messages[0] ?? null;
}

/** Instant placeholder from push payload — shown while the full thread fetch runs. */
export function buildSeedMessageFromNotification(
  data: NotificationData,
  body?: string | null,
  sender: ChatMessage["sender"] = "CUSTOMER"
): ChatMessage | null {
  if (data.type !== "new_message" || !data.conversationId || !data.messageId) {
    return null;
  }
  return {
    id: data.messageId,
    conversationId: data.conversationId,
    sender,
    body: body?.trim() || null,
    attachments: [],
    reactions: [],
    createdAt: new Date().toISOString(),
    editedAt: null,
  };
}

export function mergeMessagesCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  data: MessagesData
): void {
  queryClient.setQueryData<MessagesData>(queryKey, (old) => {
    const oldMessages = old ? (Array.isArray(old) ? old : old.messages) : [];
    const serverMessages = Array.isArray(data) ? data : (data.messages ?? []);
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
}

function seedMessagesIfEmpty(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  seed: ChatMessage
): void {
  const existing = queryClient.getQueryData<MessagesData>(queryKey);
  const existingMessages = existing
    ? Array.isArray(existing)
      ? existing
      : existing.messages
    : [];
  if (existingMessages.some((m) => m.id === seed.id)) return;
  if (existingMessages.length > 0) return;

  mergeMessagesCache(queryClient, queryKey, {
    messages: [seed],
    customerTypingAt: null,
    customerLastReadAt: null,
    staffLastReadAt: null,
    hasMore: true,
  });
}

const prefetching = new Map<string, Promise<void>>();

export async function prefetchChatForNotification(
  queryClient: QueryClient,
  role: "staff" | "customer",
  data: NotificationData | null,
  options?: { body?: string | null }
): Promise<void> {
  if (!data || data.type !== "new_message") return;

  if (role === "staff") warmStaffRequestCredentials();
  else warmCustomerRequestCredentials();

  const key =
    role === "staff" && data.conversationId
      ? `staff:${data.conversationId}`
      : role === "customer"
        ? "customer"
        : null;
  if (!key) return;

  const inFlight = prefetching.get(key);
  if (inFlight) {
    await inFlight;
    return;
  }

  const task = (async () => {
    try {
      if (role === "staff" && data.conversationId) {
        const queryKey = ["messages", data.conversationId] as const;
        const seed =
          buildSeedMessageFromNotification(data, options?.body) ??
          (() => {
            const convs = queryClient.getQueryData<Conversation[]>(conversationsQueryKey);
            const conv = convs?.find((c) => c.id === data.conversationId);
            return conv ? latestConversationMessage(conv) : null;
          })();
        if (seed) seedMessagesIfEmpty(queryClient, queryKey, seed);

        const { data: messagesData } = await api.get<MessagesData>(
          staffMessagesPath(data.conversationId, {
            limit: CHAT_MESSAGE_PAGE_SIZE,
          })
        );
        mergeMessagesCache(queryClient, queryKey, messagesData);
        void queryClient.invalidateQueries({ queryKey: conversationsQueryKey });
        void queryClient.fetchQuery({
          queryKey: conversationsQueryKey,
          queryFn: fetchStaffConversations,
        });
      } else if (role === "customer") {
        const seed = buildSeedMessageFromNotification(data, options?.body, "STAFF");
        if (seed) seedMessagesIfEmpty(queryClient, CUSTOMER_MESSAGES_QUERY_KEY, seed);

        const { data: messagesData } = await api.get<MessagesData>(
          customerMessagesPath({ limit: CHAT_MESSAGE_PAGE_SIZE }),
          { role: "customer" }
        );
        mergeMessagesCache(queryClient, CUSTOMER_MESSAGES_QUERY_KEY, messagesData);
      }
    } catch {
      // Best-effort warm cache; chat screens still fetch normally.
    }
  })();

  prefetching.set(key, task);
  try {
    await task;
  } finally {
    prefetching.delete(key);
  }
}
