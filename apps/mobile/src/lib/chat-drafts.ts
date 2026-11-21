/**
 * Chat composer drafts, keyed by conversation id (staff) or a fixed customer
 * key. Stored on `global` so the map survives Fast Refresh and screen unmounts.
 */
declare global {
  // eslint-disable-next-line no-var
  var __bikeopsChatDrafts: Map<string, string> | undefined;
}

function draftsMap(): Map<string, string> {
  if (!global.__bikeopsChatDrafts) {
    global.__bikeopsChatDrafts = new Map();
  }
  return global.__bikeopsChatDrafts;
}

export const CUSTOMER_CHAT_DRAFT_KEY = "customer";

export function getChatDraft(key: string): string {
  return draftsMap().get(key) ?? "";
}

export function setChatDraft(key: string, text: string): void {
  const drafts = draftsMap();
  if (!text) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, text);
}

export function clearChatDraft(key: string): void {
  draftsMap().delete(key);
}
