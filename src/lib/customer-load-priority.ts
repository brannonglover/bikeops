import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  loadCustomerMeData,
  type ProfileBikeSource,
} from "@/lib/customer-api";
import { CUSTOMER_MESSAGES_QUERY_KEY } from "@/hooks/useNotifications";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  customerMessagesPath,
  type ChatMessagesPage,
} from "@/lib/chat-messages";
import type { Customer, Job } from "@/lib/types";

export type CustomerDestination =
  | "home"
  | "book"
  | "repairs"
  | "chat"
  | "profile"
  | "settings";

type PriorityListener = (dest: CustomerDestination) => void;

let priority: CustomerDestination = "home";
const listeners = new Set<PriorityListener>();

export const customerMeQueryKey = ["customer-me"] as const;
export const customerJobsQueryKey = ["customer-jobs"] as const;

export function getCustomerLoadPriority(): CustomerDestination {
  return priority;
}

export function setCustomerLoadPriority(dest: CustomerDestination): void {
  if (priority === dest) return;
  priority = dest;
  for (const listener of listeners) listener(dest);
}

export function subscribeCustomerLoadPriority(
  listener: PriorityListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isCustomerHomeBackgroundAllowed(): boolean {
  return priority === "home";
}

async function fetchCustomerJobs(): Promise<Job[]> {
  const { data } = await api.get<Job[]>("/api/customer/jobs", {
    role: "customer",
  });
  return data;
}

async function fetchCustomerMessages(): Promise<ChatMessagesPage> {
  const { data } = await api.get<ChatMessagesPage>(
    customerMessagesPath({ limit: CHAT_MESSAGE_PAGE_SIZE }),
    { role: "customer" }
  );
  return data;
}

/**
 * Called from Home when the customer taps a destination. Cancels home's
 * non-essential work and starts warming the target screen's primary data.
 */
export function prioritizeCustomerDestination(
  queryClient: QueryClient,
  dest: CustomerDestination
): void {
  setCustomerLoadPriority(dest);

  if (dest !== "home" && dest !== "repairs") {
    // Badge fetch is lowest priority once they've committed to another screen.
    void queryClient.cancelQueries({ queryKey: customerJobsQueryKey });
  }

  switch (dest) {
    case "repairs":
      void queryClient.prefetchQuery({
        queryKey: customerJobsQueryKey,
        queryFn: fetchCustomerJobs,
      });
      break;
    case "chat":
      void queryClient.prefetchQuery({
        queryKey: CUSTOMER_MESSAGES_QUERY_KEY,
        queryFn: fetchCustomerMessages,
      });
      break;
    case "profile":
      void queryClient.prefetchQuery({
        queryKey: customerMeQueryKey,
        queryFn: loadCustomerMeData,
      });
      break;
    case "book":
    case "settings":
    case "home":
      break;
  }
}

export type CustomerMeQueryData = {
  customer: Customer | null;
  bikes: ProfileBikeSource[];
  synced: boolean;
};
