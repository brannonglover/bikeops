import type { NotificationData } from "@/lib/notifications";

export function normalizeNotificationData(raw: unknown): NotificationData | null {
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

export function routeForNotification(
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

export function routeForUniversalLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    const root = "bikeops.co";
    const isBikeOpsHost =
      parsed.hostname === root ||
      parsed.hostname === `www.${root}` ||
      parsed.hostname === `app.${root}` ||
      parsed.hostname.endsWith(`.${root}`);
    if (!isBikeOpsHost) return null;

    const staffChat = parsed.pathname.match(/^\/(?:open\/)?staff\/chat\/([^/]+)/);
    if (!staffChat) return null;

    const messageId = parsed.searchParams.get("messageId");
    return messageId
      ? `/(staff)/chat/${staffChat[1]}?messageId=${encodeURIComponent(messageId)}`
      : `/(staff)/chat/${staffChat[1]}`;
  } catch {
    return null;
  }
}

export function defaultRouteForRole(role: "staff" | "customer"): string {
  return role === "staff" ? "/(staff)/(jobs)" : "/(customer)/";
}
