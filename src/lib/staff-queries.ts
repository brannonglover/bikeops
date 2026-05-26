import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChatMessage, Conversation, Job } from "@/lib/types";

export const jobsQueryKey = ["jobs"] as const;
export const conversationsQueryKey = ["conversations"] as const;

export async function fetchStaffJobs(): Promise<Job[]> {
  const { data } = await api.get<Job[]>("/api/jobs");
  return data;
}

export async function fetchStaffConversations(): Promise<Conversation[]> {
  const { data } = await api.get<Conversation[]>("/api/conversations");
  return data;
}

export type MessagesQueryData =
  | ChatMessage[]
  | {
      messages: ChatMessage[];
      customerTypingAt: string | null;
      customerLastReadAt: string | null;
      staffLastReadAt: string | null;
    };

export function messagesQueryKey(conversationId: string) {
  return ["messages", conversationId] as const;
}

export async function fetchConversationMessages(
  conversationId: string
): Promise<MessagesQueryData> {
  const { data } = await api.get<MessagesQueryData>(
    `/api/conversations/${conversationId}/messages`
  );
  return data;
}

export function prefetchStaffHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.prefetchQuery({
      queryKey: jobsQueryKey,
      queryFn: fetchStaffJobs,
    }),
    queryClient.prefetchQuery({
      queryKey: conversationsQueryKey,
      queryFn: fetchStaffConversations,
    }),
  ]);
}

export function prefetchConversationMessages(
  queryClient: QueryClient,
  conversationId: string
) {
  return queryClient.prefetchQuery({
    queryKey: messagesQueryKey(conversationId),
    queryFn: () => fetchConversationMessages(conversationId),
  });
}
