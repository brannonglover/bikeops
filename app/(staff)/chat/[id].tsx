import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  StyleSheet,
  Alert,
  Keyboard,
  ActivityIndicator,
  InteractionManager,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api, ApiError, resolveUrl } from "@/lib/api";
import {
  buildPendingChatImage,
  hasUploadingPendingImages,
  isPendingChatImageReady,
  pendingChatImageDisplayUri,
  type PendingChatImage,
} from "@/lib/chat-attachments";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  mergeRecentMessagePage,
  messagesFromPagePayload,
  prependOlderMessages,
  staffMessagesPath,
} from "@/lib/chat-messages";
import { type Bike, type ChatMessage, type Conversation, type Job } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { LinkifiedText } from "@/components/chat/LinkifiedText";
import { LinkPreview } from "@/components/chat/LinkPreview";
import { GrowingTextInput } from "@/components/chat/GrowingTextInput";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_REGEX) ?? []));
}
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { customerName, formatTime } from "@/lib/format";

function paramToString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length > 0 ? s : undefined;
}

type BikeLike = { make: string; model: string | null; nickname: string | null };

function conversationBikeLabel(
  conversation: Conversation | undefined,
  opts?: { customerBikes?: BikeLike[] }
): string | null {
  if (!conversation) return null;

  const formatBike = (bike: { make: string; model: string | null; nickname: string | null }) => {
    const makeModel = [bike.make, bike.model].filter(Boolean).join(" ").trim();
    const nickname = bike.nickname?.trim();
    if (makeModel && nickname) return `${makeModel} · ${nickname}`;
    return makeModel || nickname || "";
  };

  if (conversation.job) {
    const jobBikes = conversation.job.jobBikes ?? [];
    if (jobBikes.length > 0) {
      const activeId = conversation.job.workingOnJobBikeId;
      const activeBike =
        (activeId ? jobBikes.find((jb) => jb.id === activeId) : undefined) ??
        jobBikes[0];
      const primary = activeBike ? formatBike(activeBike) : "";
      if (!primary) return null;
      return jobBikes.length > 1 ? `${primary} (+${jobBikes.length - 1})` : primary;
    }

    const jobBike = [conversation.job.bikeMake, conversation.job.bikeModel]
      .filter(Boolean)
      .join(" ")
      .trim();
    return jobBike || null;
  }

  const customerBikes =
    (conversation.customer?.bikes?.length
      ? conversation.customer.bikes
      : opts?.customerBikes) ?? [];
  if (customerBikes.length > 0) {
    const primary = formatBike(customerBikes[0]);
    if (!primary) return null;
    return customerBikes.length > 1 ? `${primary} (+${customerBikes.length - 1})` : primary;
  }

  return null;
}

function pickActiveCustomerJob(jobs: Job[] | undefined): Job | null {
  if (!jobs || jobs.length === 0) return null;
  return (
    jobs.find((job) => job.stage !== "COMPLETED" && job.stage !== "CANCELLED") ??
    jobs[0] ??
    null
  );
}

const POLL_MS = 3000;
const REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

export default function ConversationScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    fromJobId?: string | string[];
    messageId?: string | string[];
  }>();
  const id = paramToString(params.id);
  const fromJobId = paramToString(params.fromJobId);
  const messageId = paramToString(params.messageId);
  const queryClient = useQueryClient();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isAtBottomRef = useRef(true);
  const didInitialAutoScrollRef = useRef(false);
  const pendingScrollToMessageIdRef = useRef<string | null>(null);
  const composerTextRef = useRef("");
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Uncontrolled composer: controlled `value` breaks iOS autocapitalize-after-period.
  const [composerKey, setComposerKey] = useState(0);
  const [composerSeed, setComposerSeed] = useState("");
  const [composerHasText, setComposerHasText] = useState(false);
  const [composerMeasureText, setComposerMeasureText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);

  type MessagesData =
    | ChatMessage[]
    | {
        messages: ChatMessage[];
        customerTypingAt: string | null;
        customerLastReadAt: string | null;
        staffLastReadAt: string | null;
        hasMore?: boolean;
      }
    | undefined;

  const deliveryTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = useState(false);
  const hasMoreMessagesRef = useRef(true);

  useEffect(() => {
    hasMoreMessagesRef.current = true;
    setLoadingOlder(false);
    setLinkPreviewsEnabled(false);
  }, [id]);
  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(deliveryTimeoutsRef.current)) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const clearClientDeliveryStateLater = useCallback(
    (messageId: string) => {
      if (!id) return;
      const existing = deliveryTimeoutsRef.current[messageId];
      if (existing) clearTimeout(existing);

      deliveryTimeoutsRef.current[messageId] = setTimeout(() => {
        queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
          if (!old) return old;
          if (Array.isArray(old)) {
            return old.map((m) =>
              m.id === messageId ? { ...m, clientDeliveryState: undefined } : m
            );
          }
          return {
            ...old,
            messages: old.messages.map((m) =>
              m.id === messageId ? { ...m, clientDeliveryState: undefined } : m
            ),
          };
        });
        delete deliveryTimeoutsRef.current[messageId];
      }, 2000);
    },
    [id, queryClient]
  );

  type InviteStatus = "idle" | "pending" | "active";
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteDaysLeft, setInviteDaysLeft] = useState<number | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.surface,
        },
        messageList: {
          padding: spacing[4],
          paddingBottom: spacing[2],
          gap: spacing[2],
        },
        messageWrapper: {
          maxWidth: "80%",
        },
        messageWrapperOwn: {
          alignSelf: "flex-end",
        },
        messageWrapperOther: {
          alignSelf: "flex-start",
        },
        messageWrapperWithReaction: {
          marginBottom: 14,
        },
        bubble: {
          padding: spacing[3],
          borderRadius: borderRadius["2xl"],
          gap: spacing[1],
        },
        bubbleOwn: {
          backgroundColor: colors.emerald[600],
          borderBottomRightRadius: borderRadius.md,
        },
        bubbleOther: {
          backgroundColor: theme.subtleBg,
          borderBottomLeftRadius: borderRadius.md,
        },
        bubbleText: {
          ...fontSize.sm,
          lineHeight: 20,
        },
        bubbleTextOwn: {
          color: colors.white,
        },
        bubbleTextOther: {
          color: theme.text,
        },
        bubbleLinkOwn: {
          color: colors.white,
          opacity: 0.85,
        },
        bubbleLinkOther: {
          color: colors.emerald[500],
        },
        bubbleMeta: {
          ...fontSize.xs,
          alignSelf: "flex-end",
        },
        bubbleMetaOwn: {
          color: colors.emerald[200],
        },
        bubbleMetaOther: {
          color: theme.textMuted,
        },
        imageMessage: {
          gap: spacing[1],
        },
        imageMessageOwn: {
          alignItems: "flex-end",
        },
        standaloneImage: {
          width: 220,
          height: 220,
          borderRadius: borderRadius.xl,
        },
        imageMetaText: {
          ...fontSize.xs,
          color: theme.textMuted,
          alignSelf: "flex-end",
        },
        viewed: {
          ...fontSize.xs,
          color: theme.textMuted,
          alignSelf: "flex-end",
          marginTop: 2,
        },
        deliveryRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          marginTop: 2,
        },
        deliveryRowOwn: {
          alignSelf: "flex-end",
        },
        deliveryText: {
          ...fontSize.xs,
          color: theme.textMuted,
        },
        deliveryTextError: {
          ...fontSize.xs,
          color: colors.red[500],
        },
        typing: {
          ...fontSize.sm,
          color: theme.textSecondary,
          fontStyle: "italic",
          paddingVertical: spacing[2],
        },
        pendingRow: {
          flexDirection: "row",
          gap: spacing[2],
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          backgroundColor: theme.background,
        },
        pendingImageWrapper: {
          position: "relative",
        },
        pendingImage: {
          width: 60,
          height: 60,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.surfaceBorder,
        },
        pendingRemove: {
          position: "absolute",
          top: -4,
          right: -4,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: colors.red[500],
          justifyContent: "center",
          alignItems: "center",
        },
        pendingUploading: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: "rgba(0,0,0,0.35)",
          borderRadius: borderRadius.lg,
          justifyContent: "center",
          alignItems: "center",
        },
        editBanner: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          backgroundColor: theme.dark
            ? colors.emerald[800] + "55"
            : colors.emerald[50],
          borderTopWidth: 1,
          borderTopColor: theme.dark
            ? colors.emerald[700]
            : colors.emerald[200],
        },
        editBannerContent: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1.5],
        },
        editBannerText: {
          ...fontSize.sm,
          color: theme.dark ? colors.emerald[400] : colors.emerald[700],
          fontWeight: "500",
        },
        composer: {
          flexDirection: "row",
          alignItems: "flex-end",
          gap: spacing[2],
          paddingTop: spacing[3],
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[3],
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
          backgroundColor: theme.background,
        },
        imageButton: {
          padding: spacing[2],
        },
        inputShell: {
          flex: 1,
          borderWidth: 1,
          borderColor: theme.inputBorder,
          borderRadius: borderRadius.xl,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          backgroundColor: theme.inputBg,
          justifyContent: "center",
        },
        input: {
          ...fontSize.sm,
          color: theme.inputText,
          padding: 0,
          margin: 0,
          textAlignVertical: "top",
        },
        sendButton: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.emerald[600],
          justifyContent: "center",
          alignItems: "center",
        },
        sendButtonDisabled: {
          opacity: 0.5,
        },
        reactionRow: {
          position: "absolute",
          bottom: -12,
          flexDirection: "row",
          gap: spacing[0.5],
        },
        reactionRowOwn: {
          left: spacing[2],
        },
        reactionRowOther: {
          right: spacing[2],
        },
        reactionPill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          backgroundColor: theme.surface,
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing[1],
          paddingVertical: 2,
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.15,
          shadowRadius: 3,
          elevation: 3,
        },
        reactionPillMine: {
          backgroundColor: theme.dark
            ? colors.emerald[800] + "55"
            : colors.emerald[50],
        },
        reactionPillEmoji: {
          fontSize: 14,
        },
        reactionPillCount: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        popupBackdrop: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.3)",
          justifyContent: "center",
          alignItems: "center",
        },
        popupCard: {
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          borderRadius: borderRadius["2xl"],
          paddingVertical: spacing[3],
          paddingHorizontal: spacing[2],
          width: 280,
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
        },
        inviteModalCard: {
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          borderRadius: borderRadius["2xl"],
          width: 300,
          overflow: "hidden",
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
        },
        inviteModalHeader: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[4],
        },
        inviteModalIconWrap: {
          width: 40,
          height: 40,
          borderRadius: 20,
          justifyContent: "center",
          alignItems: "center",
        },
        inviteModalIconWrapActive: {
          backgroundColor: colors.emerald[100],
        },
        inviteModalIconWrapPending: {
          backgroundColor: colors.amber[100],
        },
        inviteModalIconWrapIdle: {
          backgroundColor: theme.subtleBg,
        },
        inviteModalTitle: {
          ...fontSize.base,
          fontWeight: "600",
          color: theme.text,
          flex: 1,
        },
        inviteModalDivider: {
          height: 1,
          backgroundColor: theme.surfaceBorder,
        },
        inviteModalRows: {
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          gap: spacing[2.5],
        },
        inviteModalRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
        },
        inviteModalRowLabel: {
          ...fontSize.sm,
          color: theme.textMuted,
          flex: 1,
        },
        inviteModalRowValue: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
          flexShrink: 1,
        },
        inviteModalBody: {
          ...fontSize.sm,
          color: theme.textSecondary,
          lineHeight: 20,
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
        },
        inviteModalActions: {
          flexDirection: "row",
        },
        inviteModalCancel: {
          flex: 1,
          paddingVertical: spacing[3.5],
          alignItems: "center",
          borderRightWidth: 1,
          borderRightColor: theme.surfaceBorder,
        },
        inviteModalCancelText: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.textSecondary,
        },
        inviteModalSend: {
          flex: 1,
          paddingVertical: spacing[3.5],
          alignItems: "center",
        },
        inviteModalSendText: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.emerald[600],
        },
        emojiRow: {
          flexDirection: "row",
          justifyContent: "space-around",
          paddingHorizontal: spacing[1],
          paddingBottom: spacing[2],
        },
        emojiButton: {
          width: 40,
          height: 40,
          borderRadius: 20,
          justifyContent: "center",
          alignItems: "center",
        },
        emojiButtonSelected: {
          backgroundColor: theme.dark ? colors.emerald[800] : colors.emerald[100],
        },
        emojiText: {
          fontSize: 24,
        },
        popupDivider: {
          height: 1,
          backgroundColor: theme.surfaceBorder,
          marginBottom: spacing[1],
        },
        popupAction: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          paddingVertical: spacing[2.5],
          paddingHorizontal: spacing[3],
          borderRadius: borderRadius.lg,
        },
        popupActionDestructive: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
          paddingVertical: spacing[2.5],
          paddingHorizontal: spacing[3],
          borderRadius: borderRadius.lg,
        },
        popupActionText: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.textTertiary,
        },
        scrollToBottomButton: {
          position: "absolute",
          bottom: spacing[3],
          alignSelf: "center",
          backgroundColor: theme.background,
          borderRadius: 20,
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 4,
          elevation: 4,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
        },
      }),
    [theme]
  );

  const { data: conversation } = useQuery({
    queryKey: ["conversation", id],
    queryFn: async () => {
      const { data } = await api.get<Conversation>(`/api/conversations/${id}`);
      return data;
    },
    enabled: !!id,
  });

  const jobId = conversation?.jobId ?? null;
  const { data: conversationJob } = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data } = await api.get<Job>(`/api/jobs/${jobId}`);
      return data;
    },
    enabled: !!jobId && !conversation?.job,
    staleTime: 30_000,
  });

  const resolvedConversation = useMemo(() => {
    if (!conversation) return undefined;
    if (conversation.job || !conversationJob) return conversation;
    return { ...conversation, job: conversationJob };
  }, [conversation, conversationJob]);

  const customerId = resolvedConversation?.customer?.id ?? resolvedConversation?.customerId ?? null;
  const hasJobContext = !!(resolvedConversation?.job || resolvedConversation?.jobId);
  const customerJobsQuery = useQuery({
    queryKey: ["customerJobs", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data } = await api.get<Job[]>(
        `/api/jobs?customerId=${encodeURIComponent(customerId)}`
      );
      return Array.isArray(data) ? data : [];
    },
    enabled: !!customerId && !hasJobContext,
    staleTime: 30_000,
  });
  const activeCustomerJob = useMemo(
    () => pickActiveCustomerJob(customerJobsQuery.data),
    [customerJobsQuery.data]
  );
  const hasCustomerBikesInConversation = (resolvedConversation?.customer?.bikes?.length ?? 0) > 0;
  const customerBikesQuery = useQuery({
    queryKey: ["customerBikes", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      try {
        const { data } = await api.get<Bike[]>(`/api/customers/${customerId}/bikes`);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    enabled:
      !!customerId &&
      !hasJobContext &&
      !activeCustomerJob &&
      !hasCustomerBikesInConversation,
    staleTime: 60_000,
  });

  const bikeLabel = useMemo(() => {
    const conversationForLabel =
      resolvedConversation && activeCustomerJob
        ? {
            ...resolvedConversation,
            job: activeCustomerJob,
            jobId: activeCustomerJob.id,
          }
        : resolvedConversation;
    const label = conversationBikeLabel(conversationForLabel, {
      customerBikes: customerBikesQuery.data ?? [],
    });
    if (label) return label;
    if (
      !resolvedConversation ||
      hasJobContext ||
      activeCustomerJob ||
      customerJobsQuery.isLoading ||
      !customerBikesQuery.isFetched
    ) {
      return null;
    }
    return "No bike on file";
  }, [
    activeCustomerJob,
    customerJobsQuery.isLoading,
    resolvedConversation,
    customerBikesQuery.data,
    customerBikesQuery.isFetched,
    hasJobContext,
  ]);

  const cachedMessages = queryClient.getQueryData<MessagesData>(["messages", id]);

  const {
    data: messagesData,
    isLoading,
    isError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ["messages", id],
    initialData: cachedMessages,
    queryFn: async () => {
      const path = messageId
        ? staffMessagesPath(id!)
        : staffMessagesPath(id!, { limit: CHAT_MESSAGE_PAGE_SIZE });
      const { data } = await api.get<
        | ChatMessage[]
        | {
            messages: ChatMessage[];
            customerTypingAt: string | null;
            customerLastReadAt: string | null;
            staffLastReadAt: string | null;
            hasMore?: boolean;
          }
      >(path);
      const previous = queryClient.getQueryData<MessagesData>(["messages", id]);
      const prevMessages: ChatMessage[] = previous
        ? Array.isArray(previous)
          ? previous
          : previous.messages
        : [];

      const { messages: serverMessages, hasMore } = messagesFromPagePayload(data);
      const combined = mergeRecentMessagePage(prevMessages, serverMessages);

      const previousHasMore =
        previous &&
        !Array.isArray(previous) &&
        typeof previous.hasMore === "boolean"
          ? previous.hasMore
          : hasMoreMessagesRef.current;
      // Recent-page polls always report hasMore if the thread is long; once
      // we've finished paging older messages, don't flip back to true.
      const nextHasMore = messageId
        ? false
        : previousHasMore === false
          ? false
          : hasMore;
      hasMoreMessagesRef.current = nextHasMore;

      if (Array.isArray(data)) return combined;
      return { ...data, messages: combined, hasMore: nextHasMore };
    },
    enabled: !!id,
    refetchInterval: POLL_MS,
  });

  const messages: ChatMessage[] = Array.isArray(messagesData)
    ? messagesData
    : messagesData?.messages ?? [];

  const hasMoreMessages = !Array.isArray(messagesData)
    ? Boolean(messagesData?.hasMore)
    : hasMoreMessagesRef.current;

  useEffect(() => {
    if (messages.length === 0 && isLoading) {
      setLinkPreviewsEnabled(false);
      return;
    }
    if (messages.length === 0) return;
    const task = InteractionManager.runAfterInteractions(() => {
      setLinkPreviewsEnabled(true);
    });
    return () => task.cancel();
  }, [messages.length, isLoading]);

  const loadOlderMessages = useCallback(async () => {
    if (!id || !hasMoreMessages || loadingOlder || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest || oldest.id.startsWith("temp-")) return;

    setLoadingOlder(true);
    try {
      const { data } = await api.get<
        | ChatMessage[]
        | {
            messages: ChatMessage[];
            customerTypingAt: string | null;
            customerLastReadAt: string | null;
            staffLastReadAt: string | null;
            hasMore?: boolean;
          }
      >(
        staffMessagesPath(id, {
          limit: CHAT_MESSAGE_PAGE_SIZE,
          before: oldest.id,
        })
      );
      const { messages: older, hasMore } = messagesFromPagePayload(data);
      hasMoreMessagesRef.current = hasMore;
      queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
        if (!old) {
          return Array.isArray(data)
            ? older
            : { ...data, messages: older, hasMore };
        }
        if (Array.isArray(old)) {
          return prependOlderMessages(old, older);
        }
        return {
          ...old,
          messages: prependOlderMessages(old.messages, older),
          hasMore,
        };
      });
    } catch {
      // Retry on next scroll-to-top.
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMoreMessages, id, loadingOlder, messages, queryClient]);

  const customerTypingAt = !Array.isArray(messagesData)
    ? messagesData?.customerTypingAt
    : null;
  const isCustomerTyping =
    customerTypingAt &&
    Date.now() - new Date(customerTypingAt).getTime() < 8000;

  const customerLastReadAt = !Array.isArray(messagesData)
    ? messagesData?.customerLastReadAt ?? null
    : null;

  const lastViewedOwnMsgId = useMemo(() => {
    if (!customerLastReadAt) return null;
    const readTime = new Date(customerLastReadAt).getTime();
    let lastId: string | null = null;
    for (const msg of messages) {
      if (msg.sender === "STAFF" && new Date(msg.createdAt).getTime() <= readTime) {
        lastId = msg.id;
      }
    }
    return lastId;
  }, [messages, customerLastReadAt]);

  useEffect(() => {
    // If we deep-linked to a specific message, prioritize scrolling to that.
    if (messageId) {
      pendingScrollToMessageIdRef.current = messageId;
      didInitialAutoScrollRef.current = false;
      return;
    }
    // Otherwise, ensure first render lands at the bottom.
    if (messages.length > 0) pendingScrollToMessageIdRef.current = null;
  }, [messageId, messages.length]);

  const scrollToMessageId = useCallback(
    (targetMessageId: string, opts?: { animated?: boolean }) => {
      const index = messages.findIndex((m) => m.id === targetMessageId);
      if (index < 0) return false;
      try {
        flatListRef.current?.scrollToIndex({
          index,
          animated: opts?.animated ?? false,
          viewPosition: 0.5,
        });
        return true;
      } catch {
        return false;
      }
    },
    [messages]
  );

  const ensureInitialScroll = useCallback(() => {
    if (didInitialAutoScrollRef.current) return;
    if (!flatListRef.current) return;
    if (messages.length === 0) return;

    const target = pendingScrollToMessageIdRef.current;
    if (target) {
      const ok = scrollToMessageId(target, { animated: false });
      if (ok) {
        didInitialAutoScrollRef.current = true;
        return;
      }
      // If the message isn't in the current page of messages, fall back to bottom.
      flatListRef.current.scrollToEnd({ animated: false });
      didInitialAutoScrollRef.current = true;
      return;
    }

    // Default: land at bottom.
    flatListRef.current.scrollToEnd({ animated: false });
    didInitialAutoScrollRef.current = true;
  }, [messages.length, scrollToMessageId]);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (isAtBottomRef.current) {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!conversation?.customer?.email) return;
    const fetchInviteStatus = async () => {
      try {
        const { data } = await api.get<{
          expiresAt: string | null;
          pendingInvite: boolean;
        }>(`/api/chat/session-status?customerId=${encodeURIComponent(conversation.customer.id)}`);
        if (data.expiresAt) {
          const ms = new Date(data.expiresAt).getTime() - Date.now();
          setInviteDaysLeft(Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000))));
          setInviteStatus("active");
        } else if (data.pendingInvite) {
          setInviteDaysLeft(null);
          setInviteStatus("pending");
        } else {
          setInviteStatus("idle");
        }
      } catch {
        // ignore
      }
    };
    fetchInviteStatus();
  }, [conversation?.customer?.email, conversation?.customer?.id]);

  const handleSendInvite = useCallback(async () => {
    if (!conversation?.customer) return;
    setShowInviteModal(false);
    setSendingInvite(true);
    try {
      await api.post<{ message?: string; error?: string }>(
        "/api/chat/send-invite",
        { customerId: conversation.customer.id }
      );
      setInviteStatus("pending");
    } catch {
      // silent — the modal is already closed; user can retry by tapping again
    } finally {
      setSendingInvite(false);
    }
  }, [conversation?.customer]);

  const handleInvitePress = useCallback(() => {
    setShowInviteModal(true);
  }, []);

  const handleOpenJobCard = useCallback(async () => {
    const directJobId =
      fromJobId ??
      resolvedConversation?.job?.id ??
      resolvedConversation?.jobId ??
      activeCustomerJob?.id;
    if (directJobId) {
      if (directJobId === fromJobId && router.canGoBack()) {
        router.back();
        return;
      }

      router.push({
        pathname: "/(staff)/(jobs)/[id]",
        params: { id: directJobId },
      } as never);
      return;
    }

    const currentCustomerId =
      resolvedConversation?.customer?.id ?? resolvedConversation?.customerId;
    if (!currentCustomerId) {
      Alert.alert("Job unavailable", "This conversation is not linked to a customer.");
      return;
    }

    try {
      const { data } = await api.get<Job[]>(
        `/api/jobs?customerId=${encodeURIComponent(currentCustomerId)}`
      );
      const activeJob = pickActiveCustomerJob(data);

      if (!activeJob) {
        Alert.alert("No job card", "This customer does not have a job card yet.");
        return;
      }

      if (activeJob.id === fromJobId && router.canGoBack()) {
        router.back();
        return;
      }

      router.push({
        pathname: "/(staff)/(jobs)/[id]",
        params: { id: activeJob.id },
      } as never);
    } catch {
      Alert.alert("Error", "Failed to open the job card");
    }
  }, [activeCustomerJob, fromJobId, resolvedConversation, router]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      const atBottom = distanceFromBottom < 60;
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom);

      const canLoadOlder =
        didInitialAutoScrollRef.current &&
        contentSize.height > layoutMeasurement.height + 40 &&
        contentOffset.y < 80;
      if (canLoadOlder) {
        void loadOlderMessages();
      }
    },
    [loadOlderMessages]
  );

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const resetComposer = useCallback((next = "") => {
    composerTextRef.current = next;
    setComposerSeed(next);
    setComposerMeasureText(next);
    setComposerHasText(next.trim().length > 0);
    setComposerKey((k) => k + 1);
  }, []);

  const handleSend = useCallback(async () => {
    const textToSend = composerTextRef.current.trim();
    const imagesToSend = pendingImages.filter(isPendingChatImageReady);
    if (!textToSend && imagesToSend.length === 0) return;
    if (hasUploadingPendingImages(pendingImages)) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: id as string,
      sender: "STAFF",
      body: textToSend || null,
      attachments: imagesToSend.map((img) => ({
        id: img.id!,
        url: img.url ?? img.previewUri,
        filename: img.filename,
        mimeType: "",
        messageId: null,
        createdAt: new Date().toISOString(),
      })),
      reactions: [],
      createdAt: new Date().toISOString(),
      editedAt: null,
      clientDeliveryState: "SENDING",
    };

    queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
      if (!old) return old;
      if (Array.isArray(old)) return [...old, optimisticMsg];
      return { ...old, messages: [...old.messages, optimisticMsg] };
    });

    resetComposer("");
    setPendingImages([]);
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    setSending(true);

    try {
      const { data: newMsg } = await api.post<ChatMessage>(`/api/conversations/${id}/messages`, {
        sender: "STAFF",
        body: textToSend || null,
        attachmentIds: imagesToSend.map((p) => p.id!),
      });
      const deliveredMsg: ChatMessage = { ...newMsg, clientDeliveryState: "DELIVERED" };
      queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
        if (!old) return old;
        if (Array.isArray(old)) return old.map((m) => (m.id === tempId ? deliveredMsg : m));
        return {
          ...old,
          messages: old.messages.map((m) => (m.id === tempId ? deliveredMsg : m)),
        };
      });
      clearClientDeliveryStateLater(deliveredMsg.id);
      queryClient.invalidateQueries({ queryKey: ["messages", id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
        if (!old) return old;
        if (Array.isArray(old)) return old.filter((m) => m.id !== tempId);
        return { ...old, messages: old.messages.filter((m) => m.id !== tempId) };
      });
      Alert.alert("Error", "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [id, pendingImages, queryClient, clearClientDeliveryStateLater, resetComposer]);

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    let pending: PendingChatImage;
    let formData: FormData;
    try {
      ({ pending, formData } = await buildPendingChatImage(result.assets[0]));
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to prepare image"
      );
      return;
    }
    setPendingImages((prev) => [...prev, pending]);

    try {
      const { data } = await api.postForm<{
        id: string;
        url: string;
        filename: string;
      }>("/api/chat/upload", formData);
      setPendingImages((prev) =>
        prev.map((img) =>
          img.localId === pending.localId
            ? {
                ...img,
                id: data.id,
                url: data.url,
                filename: data.filename,
                status: "ready",
              }
            : img
        )
      );
    } catch (err) {
      setPendingImages((prev) =>
        prev.map((img) =>
          img.localId === pending.localId ? { ...img, status: "failed" } : img
        )
      );
      Alert.alert(
        "Error",
        err instanceof ApiError ? err.message : "Failed to upload image"
      );
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    Alert.alert("Delete Message", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/api/conversations/${id}/messages/${messageId}`);
            queryClient.invalidateQueries({ queryKey: ["messages", id] });
          } catch {
            Alert.alert("Error", "Failed to delete");
          }
        },
      },
    ]);
  };

  const startEditing = useCallback((message: ChatMessage) => {
    setEditingMessage(message);
    resetComposer(message.body || "");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [resetComposer]);

  const cancelEditing = useCallback(() => {
    setEditingMessage(null);
    resetComposer("");
    Keyboard.dismiss();
  }, [resetComposer]);

  const handleEdit = useCallback(async () => {
    if (!editingMessage || !composerTextRef.current.trim()) return;

    const newBody = composerTextRef.current.trim();
    const editedMsgId = editingMessage.id;

    type MessagesData =
      | ChatMessage[]
      | {
          messages: ChatMessage[];
          customerTypingAt: string | null;
          customerLastReadAt: string | null;
          staffLastReadAt: string | null;
        }
      | undefined;

    const previousData = queryClient.getQueryData<MessagesData>(["messages", id]);

    const applyEdit = (msgs: ChatMessage[]) =>
      msgs.map((m) =>
        m.id === editedMsgId
          ? { ...m, body: newBody, editedAt: new Date().toISOString() }
          : m
      );

    queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
      if (!old) return old;
      if (Array.isArray(old)) return applyEdit(old);
      return { ...old, messages: applyEdit(old.messages) };
    });

    setEditingMessage(null);
    resetComposer("");
    setSending(true);

    try {
      await api.patch(
        `/api/conversations/${id}/messages/${editedMsgId}`,
        { body: newBody }
      );
      queryClient.invalidateQueries({ queryKey: ["messages", id] });
    } catch {
      queryClient.setQueryData(["messages", id], previousData);
      Alert.alert("Error", "Failed to edit message");
    } finally {
      setSending(false);
    }
  }, [editingMessage, id, queryClient, resetComposer]);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const msg = messages.find((m) => m.id === messageId);
      const myReaction = (msg?.reactions ?? []).find(
        (r) => r.reactorType === "STAFF"
      );
      const isRemoving = myReaction?.emoji === emoji;

      type MessagesData =
        | ChatMessage[]
        | {
            messages: ChatMessage[];
            customerTypingAt: string | null;
            customerLastReadAt: string | null;
            staffLastReadAt: string | null;
          }
        | undefined;

      const previousData = queryClient.getQueryData<MessagesData>(["messages", id]);

      const applyReaction = (msgs: ChatMessage[]) =>
        msgs.map((m) => {
          if (m.id !== messageId) return m;
          const withoutMine = (m.reactions ?? []).filter(
            (r) => r.reactorType !== "STAFF"
          );
          const reactions = isRemoving
            ? withoutMine
            : [
                ...withoutMine,
                {
                  id: `temp-reaction-${messageId}`,
                  messageId,
                  emoji,
                  reactorType: "STAFF" as const,
                  createdAt: new Date().toISOString(),
                },
              ];
          return { ...m, reactions };
        });

      const seedMessages = (): ChatMessage[] => {
        if (previousData) {
          return Array.isArray(previousData)
            ? previousData
            : previousData.messages;
        }
        return messages;
      };

      const withReaction = (msgs: ChatMessage[]) => applyReaction(msgs);

      queryClient.setQueryData<MessagesData>(["messages", id], (old) => {
        if (!old) {
          const seeded = withReaction(seedMessages());
          return seeded;
        }
        if (Array.isArray(old)) return withReaction(old);
        return { ...old, messages: withReaction(old.messages) };
      });

      try {
        if (isRemoving) {
          await api.delete(
            `/api/conversations/${id}/messages/${messageId}/reactions`
          );
        } else {
          await api.post(
            `/api/conversations/${id}/messages/${messageId}/reactions`,
            { emoji }
          );
        }
      } catch {
        queryClient.setQueryData(["messages", id], previousData);
      }
    },
    [id, messages, queryClient]
  );

  if (!id) {
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <EmptyState
          icon="chatbubbles-outline"
          title="Chat unavailable"
          message="This conversation link is invalid. Go back and try again."
        />
      </>
    );
  }

  if (isLoading && !cachedMessages && messages.length === 0) {
    return <LoadingScreen message="Loading messages..." />;
  }

  if (isError) {
    return (
      <>
        <Stack.Screen options={{ title: "Conversation" }} />
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: spacing[6],
            gap: spacing[3],
            backgroundColor: theme.surface,
          }}
        >
          <Text
            style={{
              ...fontSize.sm,
              color: theme.textSecondary,
              textAlign: "center",
            }}
          >
            Could not load messages. Check your connection and try again.
          </Text>
          <Button title="Retry" onPress={() => refetchMessages()} variant="secondary" />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <TouchableOpacity
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.navigate("/(staff)/chat");
                  }
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ padding: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={24} color={theme.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleOpenJobCard}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ padding: spacing[2] }}
                accessibilityRole="button"
                accessibilityLabel="Open job card"
              >
                <Ionicons name="construct-outline" size={20} color={theme.icon} />
              </TouchableOpacity>
            </View>
          ),
          headerTitle: () => {
            const name = resolvedConversation
              ? customerName(resolvedConversation.customer)
              : "Conversation";
            const canOpenCustomer = !!resolvedConversation?.customer?.id;

            return (
              <Pressable
                onPress={() => {
                  if (!resolvedConversation?.customer?.id) return;
                  router.push(`/(staff)/customers/${resolvedConversation.customer.id}`);
                }}
                disabled={!canOpenCustomer}
                accessibilityRole={canOpenCustomer ? "button" : undefined}
                accessibilityLabel={
                  canOpenCustomer ? `Open ${name} profile` : undefined
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) => ({
                  alignItems: Platform.OS === "android" ? "flex-start" : "center",
                  opacity: canOpenCustomer && pressed ? 0.6 : 1,
                })}
              >
                <Text
                  style={{
                    ...fontSize.base,
                    lineHeight: 20,
                    fontWeight: "700",
                    color: theme.text,
                  }}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                {bikeLabel ? (
                  <Text
                    style={{
                      ...fontSize.xs,
                      fontWeight: "500",
                      color: theme.textSecondary,
                    }}
                    numberOfLines={1}
                  >
                    {bikeLabel}
                  </Text>
                ) : null}
              </Pressable>
            );
          },
          headerRight: () => {
            const hasSmsConsent =
              !!resolvedConversation?.customer?.phone?.trim() &&
              resolvedConversation.customer.smsConsent === true;
            const smsIconColor = hasSmsConsent
              ? colors.emerald[500]
              : theme.iconMuted;
            const canInvite = !!conversation?.customer?.email;

            return (
              <TouchableOpacity
                onPress={canInvite ? handleInvitePress : undefined}
                disabled={!canInvite || sendingInvite}
                style={{
                  padding: spacing[2],
                  opacity: sendingInvite ? 0.5 : 1,
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={
                  hasSmsConsent ? "SMS consent given" : "SMS consent not given"
                }
              >
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={20}
                  color={smsIconColor}
                />
              </TouchableOpacity>
            );
          },
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        // Header is outside this view; useHeaderHeight() was double-counting.
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          initialNumToRender={16}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS === "android"}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
          }}
          onContentSizeChange={() => {
            requestAnimationFrame(() => {
              if (isAtBottomRef.current && didInitialAutoScrollRef.current) {
                flatListRef.current?.scrollToEnd({ animated: false });
              } else {
                ensureInitialScroll();
              }
            });
          }}
          onScrollToIndexFailed={(info) => {
            // Retry after RN measures more items.
            setTimeout(() => {
              if (!flatListRef.current) return;
              const target = pendingScrollToMessageIdRef.current;
              if (target) {
                const ok = scrollToMessageId(target, { animated: false });
                if (ok) return;
              }
              try {
                flatListRef.current?.scrollToOffset({
                  offset: Math.max(0, info.averageItemLength * info.index),
                  animated: false,
                });
              } catch {
                // ignore
              }
            }, 250);
          }}
          ListHeaderComponent={
            loadingOlder ? (
              <View style={{ paddingVertical: spacing[3] }}>
                <ActivityIndicator color={theme.iconMuted} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isOwn = item.sender === "STAFF";
            const hasAttachments = (item.attachments?.length ?? 0) > 0;
            const imageOnly = hasAttachments && !item.body;
            const splitBubble = hasAttachments && !!item.body;
            const hasReactions = (item.reactions?.length ?? 0) > 0;
            return (
              <View
                style={[
                  styles.messageWrapper,
                  isOwn
                    ? styles.messageWrapperOwn
                    : styles.messageWrapperOther,
                  hasReactions && styles.messageWrapperWithReaction,
                ]}
              >
                {splitBubble ? (
                  <View style={[styles.imageMessage, isOwn && styles.imageMessageOwn]}>
                    {item.attachments?.map(
                      (att: { id: string; url: string }) => (
                        <TouchableOpacity
                          key={att.id}
                          activeOpacity={0.8}
                          onPress={() =>
                            setViewingImageUrl(resolveUrl(att.url))
                          }
                          onLongPress={() => setActiveMessage(item)}
                        >
                          <Image
                            source={{ uri: resolveUrl(att.url) }}
                            style={styles.standaloneImage}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      )
                    )}
                    <TouchableOpacity
                      onLongPress={() => setActiveMessage(item)}
                      activeOpacity={0.7}
                      style={[
                        styles.bubble,
                        isOwn ? styles.bubbleOwn : styles.bubbleOther,
                      ]}
                    >
                      <LinkifiedText
                        text={item.body ?? ""}
                        style={[
                          styles.bubbleText,
                          isOwn
                            ? styles.bubbleTextOwn
                            : styles.bubbleTextOther,
                        ]}
                        linkStyle={
                          isOwn
                            ? styles.bubbleLinkOwn
                            : styles.bubbleLinkOther
                        }
                      />
                      <Text
                        style={[
                          styles.bubbleMeta,
                          isOwn
                            ? styles.bubbleMetaOwn
                            : styles.bubbleMetaOther,
                        ]}
                      >
                        {formatTime(item.createdAt)}
                        {item.editedAt ? " (edited)" : ""}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onLongPress={() => setActiveMessage(item)}
                    activeOpacity={0.7}
                    style={
                      imageOnly
                        ? [styles.imageMessage, isOwn && styles.imageMessageOwn]
                        : [
                            styles.bubble,
                            isOwn ? styles.bubbleOwn : styles.bubbleOther,
                          ]
                    }
                  >
                    {item.attachments?.map(
                      (att: { id: string; url: string }) => (
                        <TouchableOpacity
                          key={att.id}
                          activeOpacity={0.8}
                          onPress={() =>
                            setViewingImageUrl(resolveUrl(att.url))
                          }
                          onLongPress={() => setActiveMessage(item)}
                        >
                          <Image
                            source={{ uri: resolveUrl(att.url) }}
                            style={styles.standaloneImage}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      )
                    )}
                    {item.body ? (
                      <LinkifiedText
                        text={item.body}
                        style={[
                          styles.bubbleText,
                          isOwn
                            ? styles.bubbleTextOwn
                            : styles.bubbleTextOther,
                        ]}
                        linkStyle={
                          isOwn
                            ? styles.bubbleLinkOwn
                            : styles.bubbleLinkOther
                        }
                      />
                    ) : null}
                    <Text
                      style={[
                        styles.bubbleMeta,
                        imageOnly
                          ? styles.imageMetaText
                          : isOwn
                            ? styles.bubbleMetaOwn
                            : styles.bubbleMetaOther,
                      ]}
                    >
                      {formatTime(item.createdAt)}
                      {item.editedAt ? " (edited)" : ""}
                    </Text>
                  </TouchableOpacity>
                )}
                {isOwn && item.clientDeliveryState ? (
                  <View style={[styles.deliveryRow, styles.deliveryRowOwn]}>
                    {item.clientDeliveryState === "SENDING" ? (
                      <>
                        <ActivityIndicator size="small" color={theme.textMuted} />
                        <Text style={styles.deliveryText}>Sending…</Text>
                      </>
                    ) : item.clientDeliveryState === "DELIVERED" ? (
                      <>
                        <Ionicons name="checkmark" size={14} color={theme.textMuted} />
                        <Text style={styles.deliveryText}>Delivered</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons
                          name="alert-circle-outline"
                          size={14}
                          color={colors.red[500]}
                        />
                        <Text style={styles.deliveryTextError}>Not delivered</Text>
                      </>
                    )}
                  </View>
                ) : null}
                {item.body
                  ? extractUrls(item.body).map((url) => (
                      <LinkPreview
                        key={url}
                        url={url}
                        enabled={linkPreviewsEnabled}
                      />
                    ))
                  : null}
                {hasReactions ? (
                  <View
                    style={[
                      styles.reactionRow,
                      isOwn
                        ? styles.reactionRowOwn
                        : styles.reactionRowOther,
                    ]}
                  >
                    {Object.entries(
                      (item.reactions ?? []).reduce<Record<string, number>>(
                        (acc, r) => {
                          acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                          return acc;
                        },
                        {}
                      )
                    ).map(([emoji, count]) => {
                      const isMine = (item.reactions ?? []).some(
                        (r) => r.emoji === emoji && r.reactorType === "STAFF"
                      );
                      return (
                        <TouchableOpacity
                          key={emoji}
                          onPress={() => toggleReaction(item.id, emoji)}
                          style={[
                            styles.reactionPill,
                            isMine && styles.reactionPillMine,
                          ]}
                        >
                          <Text style={styles.reactionPillEmoji}>{emoji}</Text>
                          {count > 1 ? (
                            <Text style={styles.reactionPillCount}>
                              {count}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
                {isOwn && item.id === lastViewedOwnMsgId ? (
                  <Text style={styles.viewed}>Viewed</Text>
                ) : null}
              </View>
            );
          }}
          ListFooterComponent={
            isCustomerTyping ? (
              <Text style={styles.typing}>Customer is typing...</Text>
            ) : null
          }
        />
        {showScrollButton ? (
          <TouchableOpacity
            style={styles.scrollToBottomButton}
            onPress={scrollToBottom}
          >
            <Ionicons name="chevron-down" size={20} color={theme.icon} />
          </TouchableOpacity>
        ) : null}
        </View>

        {pendingImages.length > 0 ? (
          <View style={styles.pendingRow}>
            {pendingImages.map((p) => (
              <View key={p.localId} style={styles.pendingImageWrapper}>
                <Image
                  source={{ uri: pendingChatImageDisplayUri(p) }}
                  style={styles.pendingImage}
                  resizeMode="cover"
                />
                {p.status === "uploading" ? (
                  <View style={styles.pendingUploading} pointerEvents="none">
                    <ActivityIndicator size="small" color={colors.white} />
                  </View>
                ) : null}
                <TouchableOpacity
                  onPress={() =>
                    setPendingImages((prev) =>
                      prev.filter((i) => i.localId !== p.localId)
                    )
                  }
                  style={styles.pendingRemove}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {editingMessage ? (
          <View style={styles.editBanner}>
            <View style={styles.editBannerContent}>
              <Ionicons name="pencil" size={14} color={colors.emerald[600]} />
              <Text style={styles.editBannerText}>Editing message</Text>
            </View>
            <TouchableOpacity onPress={cancelEditing}>
              <Ionicons name="close" size={18} color={theme.icon} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.composer}>
          {!editingMessage ? (
            <TouchableOpacity onPress={handlePickImage} style={styles.imageButton}>
              <Ionicons name="image-outline" size={24} color={theme.icon} />
            </TouchableOpacity>
          ) : null}
          <GrowingTextInput
            key={composerKey}
            defaultValue={composerSeed}
            measureText={composerMeasureText}
            onChangeText={(next) => {
              composerTextRef.current = next;
              setComposerMeasureText(next);
              setComposerHasText(next.trim().length > 0);
            }}
            placeholder={editingMessage ? "Edit message..." : "Type a message..."}
            shellStyle={styles.inputShell}
            style={styles.input}
            placeholderTextColor={theme.textMuted}
            maxLength={5000}
            autoCapitalize="sentences"
            autoCorrect
            onSubmitEditing={editingMessage ? handleEdit : handleSend}
          />
          <TouchableOpacity
            onPress={editingMessage ? handleEdit : handleSend}
            disabled={
              sending ||
              hasUploadingPendingImages(pendingImages) ||
              (!composerHasText &&
                !editingMessage &&
                pendingImages.filter(isPendingChatImageReady).length === 0)
            }
            style={[
              styles.sendButton,
              (sending ||
                hasUploadingPendingImages(pendingImages) ||
                (!composerHasText &&
                  !editingMessage &&
                  pendingImages.filter(isPendingChatImageReady).length === 0)) &&
                styles.sendButtonDisabled,
            ]}
          >
            <Ionicons
              name={editingMessage ? "checkmark" : "send"}
              size={18}
              color={colors.white}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ImageViewer uri={viewingImageUrl} onClose={() => setViewingImageUrl(null)} />

      <Modal
        visible={!!activeMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveMessage(null)}
      >
        <Pressable
          style={styles.popupBackdrop}
          onPress={() => setActiveMessage(null)}
        >
          <View
            style={styles.popupCard}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.emojiRow}>
              {REACTION_EMOJIS.map((emoji) => {
                const myReaction = (activeMessage?.reactions ?? []).find(
                  (r) => r.reactorType === "STAFF"
                );
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => {
                      const msgId = activeMessage!.id;
                      setActiveMessage(null);
                      toggleReaction(msgId, emoji);
                    }}
                    style={[
                      styles.emojiButton,
                      myReaction?.emoji === emoji && styles.emojiButtonSelected,
                    ]}
                  >
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.popupDivider} />
            {activeMessage?.sender === "STAFF" && activeMessage?.body ? (
              <TouchableOpacity
                style={styles.popupAction}
                onPress={() => {
                  const msg = activeMessage;
                  setActiveMessage(null);
                  startEditing(msg);
                }}
              >
                <Ionicons name="pencil" size={16} color={theme.textTertiary} />
                <Text style={styles.popupActionText}>Edit</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.popupActionDestructive}
              onPress={() => {
                const msgId = activeMessage!.id;
                setActiveMessage(null);
                handleDeleteMessage(msgId);
              }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
              <Text style={[styles.popupActionText, { color: colors.red[600] }]}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showInviteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <Pressable
          style={styles.popupBackdrop}
          onPress={() => setShowInviteModal(false)}
        >
          <View
            style={styles.inviteModalCard}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.inviteModalHeader}>
              <View
                style={[
                  styles.inviteModalIconWrap,
                  inviteStatus === "active"
                    ? styles.inviteModalIconWrapActive
                    : inviteStatus === "pending"
                      ? styles.inviteModalIconWrapPending
                      : styles.inviteModalIconWrapIdle,
                ]}
              >
                <Ionicons
                  name={inviteStatus === "active" ? "mail-open-outline" : "mail-outline"}
                  size={22}
                  color={
                    inviteStatus === "active"
                      ? colors.emerald[600]
                      : inviteStatus === "pending"
                        ? colors.amber[600]
                        : theme.icon
                  }
                />
              </View>
              <Text style={styles.inviteModalTitle}>
                {inviteStatus === "active"
                  ? "Chat Access Active"
                  : inviteStatus === "pending"
                    ? "Invite Pending"
                    : "Invite to Chat"}
              </Text>
            </View>

            <View style={styles.inviteModalDivider} />

            {inviteStatus === "active" ? (
              <View style={styles.inviteModalRows}>
                <View style={styles.inviteModalRow}>
                  <Ionicons name="checkmark-circle-outline" size={15} color={colors.emerald[500]} />
                  <Text style={styles.inviteModalRowLabel}>Status</Text>
                  <Text style={[styles.inviteModalRowValue, { color: colors.emerald[600] }]}>Accepted</Text>
                </View>
                {inviteDaysLeft !== null ? (
                  <View style={styles.inviteModalRow}>
                    <Ionicons name="time-outline" size={15} color={theme.textMuted} />
                    <Text style={styles.inviteModalRowLabel}>Expires in</Text>
                    <Text style={styles.inviteModalRowValue}>
                      {inviteDaysLeft} day{inviteDaysLeft === 1 ? "" : "s"}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.inviteModalRow}>
                  <Ionicons name="mail-outline" size={15} color={theme.textMuted} />
                  <Text style={styles.inviteModalRowLabel}>Email</Text>
                  <Text style={styles.inviteModalRowValue} numberOfLines={1}>
                    {conversation?.customer?.email}
                  </Text>
                </View>
              </View>
            ) : inviteStatus === "pending" ? (
              <View style={styles.inviteModalRows}>
                <View style={styles.inviteModalRow}>
                  <Ionicons name="time-outline" size={15} color={colors.amber[500]} />
                  <Text style={styles.inviteModalRowLabel}>Status</Text>
                  <Text style={[styles.inviteModalRowValue, { color: colors.amber[600] }]}>Sent · awaiting sign-in</Text>
                </View>
                <View style={styles.inviteModalRow}>
                  <Ionicons name="mail-outline" size={15} color={theme.textMuted} />
                  <Text style={styles.inviteModalRowLabel}>Email</Text>
                  <Text style={styles.inviteModalRowValue} numberOfLines={1}>
                    {conversation?.customer?.email}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.inviteModalBody}>
                Send a sign-in link to {conversation?.customer?.email} so they can join the conversation.
              </Text>
            )}

            <View style={styles.inviteModalDivider} />

            <View style={styles.inviteModalActions}>
              <TouchableOpacity
                style={styles.inviteModalCancel}
                onPress={() => setShowInviteModal(false)}
              >
                <Text style={styles.inviteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.inviteModalSend, sendingInvite && { opacity: 0.5 }]}
                onPress={handleSendInvite}
                disabled={sendingInvite}
              >
                <Text style={styles.inviteModalSendText}>
                  {inviteStatus === "idle" ? "Send invite" : "Resend"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
