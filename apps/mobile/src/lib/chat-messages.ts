import type { ChatMessage } from "@/lib/types";

/** Recent page size for chat open / poll — keeps first paint fast on long threads. */
export const CHAT_MESSAGE_PAGE_SIZE = 75;

export type ChatMessagesPage = {
  messages: ChatMessage[];
  hasMore?: boolean;
  staffLastReadAt?: string | null;
  customerTypingAt?: string | null;
  customerLastReadAt?: string | null;
};

export function customerMessagesPath(opts?: {
  limit?: number;
  before?: string;
}): string {
  return withMessagePageParams("/api/chat/conversation/messages", opts);
}

export function staffMessagesPath(
  conversationId: string,
  opts?: { limit?: number; before?: string }
): string {
  return withMessagePageParams(
    `/api/conversations/${conversationId}/messages`,
    opts
  );
}

function withMessagePageParams(
  path: string,
  opts?: { limit?: number; before?: string }
): string {
  const params = new URLSearchParams();
  if (opts?.limit && opts.limit > 0) {
    params.set("limit", String(opts.limit));
  }
  if (opts?.before) params.set("before", opts.before);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Merge a newest-page poll into local state without dropping older messages
 * that were loaded via pagination.
 */
export function mergeRecentMessagePage(
  previous: ChatMessage[],
  serverMessages: ChatMessage[]
): ChatMessage[] {
  const prevById = new Map(previous.map((m) => [m.id, m]));
  const merged = serverMessages.map((m) => {
    const prev = prevById.get(m.id);
    return prev?.clientDeliveryState
      ? { ...m, clientDeliveryState: prev.clientDeliveryState }
      : m;
  });

  const serverIds = new Set(serverMessages.map((m) => m.id));
  const oldestIncoming = serverMessages[0];
  const older = oldestIncoming
    ? previous.filter(
        (m) =>
          !serverIds.has(m.id) &&
          !m.id.startsWith("temp-") &&
          new Date(m.createdAt).getTime() <
            new Date(oldestIncoming.createdAt).getTime()
      )
    : previous.filter((m) => !serverIds.has(m.id) && !m.id.startsWith("temp-"));

  const optimistic = previous.filter(
    (m) => m.id.startsWith("temp-") && !serverIds.has(m.id)
  );

  return [...older, ...merged, ...optimistic];
}

export function prependOlderMessages(
  previous: ChatMessage[],
  olderMessages: ChatMessage[]
): ChatMessage[] {
  if (olderMessages.length === 0) return previous;
  const existingIds = new Set(previous.map((m) => m.id));
  const unique = olderMessages.filter((m) => !existingIds.has(m.id));
  if (unique.length === 0) return previous;
  return [...unique, ...previous];
}

export function messagesFromPagePayload(
  data: ChatMessage[] | ChatMessagesPage
): { messages: ChatMessage[]; hasMore: boolean } {
  if (Array.isArray(data)) {
    return { messages: data, hasMore: false };
  }
  return {
    messages: data.messages ?? [],
    hasMore: Boolean(data.hasMore),
  };
}
