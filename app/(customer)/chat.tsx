import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  StyleSheet,
  Alert,
  Keyboard,
  Linking,
  ActivityIndicator,
  InteractionManager,
  AppState,
  type AppStateStatus,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Stack, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError, isCustomerAuthenticated, resolveCustomerUrl, getCustomerShop, setCustomerShop, parseShopSubdomainFromUrl, peekCustomerSessionCookie } from "@/lib/api";
import {
  getCustomerProfile,
  rememberShop,
  type PastShop,
} from "@/lib/customer-profile";
import {
  buildPendingChatImage,
  buildPendingChatVideo,
  hasUploadingPendingImages,
  isChatVideoAsset,
  isPendingChatImageReady,
  pendingChatImageDisplayUri,
  uploadPendingChatVideo,
  type PendingChatImage,
} from "@/lib/chat-attachments";
import { useAuth } from "@/lib/auth";
import { CUSTOMER_MESSAGES_QUERY_KEY } from "@/hooks/useNotifications";
import {
  prioritizeCustomerDestination,
} from "@/lib/customer-load-priority";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  customerMessagesPath,
  mergeRecentMessagePage,
  messagesFromPagePayload,
  prependOlderMessages,
  type ChatMessagesPage,
} from "@/lib/chat-messages";
import {
  clearChatDraft,
  CUSTOMER_CHAT_DRAFT_KEY,
  getChatDraft,
  setChatDraft,
} from "@/lib/chat-drafts";
import { type ChatMessage } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { SectionLoader } from "@/components/ui/SectionLoader";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { VideoViewer } from "@/components/ui/VideoViewer";
import {
  ChatAttachmentMedia,
  isVideoMimeType,
} from "@/components/chat/ChatAttachmentMedia";
import { LinkifiedText } from "@/components/chat/LinkifiedText";
import { LinkPreview } from "@/components/chat/LinkPreview";
import { GrowingTextInput } from "@/components/chat/GrowingTextInput";
import {
  ShopPicker,
  ShopPickerModal,
  type SelectedShop,
} from "@/components/customer/ShopPicker";
import { formatTime } from "@/lib/format";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_REGEX) ?? []));
}

const POLL_MS = 3000;
const REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

type AuthState = "loading" | "needs_login" | "authenticated";

type MessagesCache =
  | ChatMessage[]
  | {
      messages: ChatMessage[];
      staffLastReadAt?: string | null;
      hasMore?: boolean;
    };

function readCachedThread(queryClient: {
  getQueryData: <T>(key: readonly unknown[]) => T | undefined;
}): {
  messages: ChatMessage[];
  staffLastReadAt: string | null;
  ready: boolean;
} {
  const cached = queryClient.getQueryData<MessagesCache>(
    CUSTOMER_MESSAGES_QUERY_KEY
  );
  if (!cached) {
    return { messages: [], staffLastReadAt: null, ready: false };
  }
  if (Array.isArray(cached)) {
    return { messages: cached, staffLastReadAt: null, ready: true };
  }
  return {
    messages: cached.messages ?? [],
    staffLastReadAt: cached.staffLastReadAt ?? null,
    ready: true,
  };
}

export default function CustomerChatScreen() {
  const { theme } = useTheme();
  const { role, setCustomerAuthenticated, customerLogout } = useAuth();
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isAtBottomRef = useRef(true);
  const didInitialAutoScrollRef = useRef(false);
  const pendingScrollToMessageIdRef = useRef<string | null>(null);
  const params = useLocalSearchParams<{ messageId?: string | string[] }>();
  const messageId =
    params.messageId === undefined
      ? undefined
      : Array.isArray(params.messageId)
        ? params.messageId[0]
        : params.messageId;
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Trust in-memory auth so revisits don't flash a loader while SecureStore /
  // /api/chat/me catch up. Shop presence is confirmed in the bootstrap effect.
  const [authState, setAuthState] = useState<AuthState>(() =>
    role === "customer" ? "authenticated" : "loading"
  );
  const [email, setEmail] = useState("");
  const [requestingLogin, setRequestingLogin] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [selectedShop, setSelectedShop] = useState<SelectedShop | null>(null);
  const [pastShops, setPastShops] = useState<PastShop[]>([]);
  const [changeShopOpen, setChangeShopOpen] = useState(false);

  const [token, setToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const cachedThread = readCachedThread(queryClient);
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => cachedThread.messages
  );
  const [messagesReady, setMessagesReady] = useState(
    () => cachedThread.ready
  );
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = useState(false);
  const [staffLastReadAt, setStaffLastReadAt] = useState<string | null>(
    () => cachedThread.staffLastReadAt
  );
  const [text, setText] = useState(() => getChatDraft(CUSTOMER_CHAT_DRAFT_KEY));
  const textRef = useRef(text);
  textRef.current = text;
  const editingMessageRef = useRef<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  editingMessageRef.current = editingMessage;
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [viewingVideoUrl, setViewingVideoUrl] = useState<string | null>(null);

  const deliveryTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(deliveryTimeoutsRef.current)) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const clearClientDeliveryStateLater = useCallback((messageId: string) => {
    const existing = deliveryTimeoutsRef.current[messageId];
    if (existing) clearTimeout(existing);

    deliveryTimeoutsRef.current[messageId] = setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, clientDeliveryState: undefined } : m
        )
      );
      delete deliveryTimeoutsRef.current[messageId];
    }, 2000);
  }, []);

  const clearThreadState = useCallback(() => {
    setMessages([]);
    setMessagesReady(false);
    setHasMoreMessages(true);
    setLoadingOlder(false);
    setStaffLastReadAt(null);
    setPendingImages([]);
    setText("");
    clearChatDraft(CUSTOMER_CHAT_DRAFT_KEY);
    setEditingMessage(null);
    setActiveMessage(null);
    setShowScrollButton(false);
    didInitialAutoScrollRef.current = false;
    queryClient.removeQueries({ queryKey: CUSTOMER_MESSAGES_QUERY_KEY });
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [profile, stored, cookie] = await Promise.all([
        getCustomerProfile(),
        getCustomerShop(),
        peekCustomerSessionCookie(),
      ]);
      if (cancelled) return;

      setPastShops(profile.pastShops);
      if (profile.email) setEmail((prev) => prev || profile.email);

      let shop: SelectedShop | null = null;
      if (stored?.subdomain) {
        shop = {
          subdomain: stored.subdomain,
          name: stored.name ?? stored.subdomain,
        };
      } else if (profile.pastShops[0]) {
        const past = profile.pastShops[0];
        shop = { subdomain: past.subdomain, name: past.name };
      }
      setSelectedShop(shop);

      // Local signals are enough to paint chat; validate the session in the
      // background so revisits aren't blocked on /api/chat/me.
      const hasLocalSession = (role === "customer" || !!cookie) && !!shop;
      if (hasLocalSession) {
        setAuthState("authenticated");
        void isCustomerAuthenticated().then((ok) => {
          if (cancelled || ok) return;
          setAuthState("needs_login");
          setMessagesReady(false);
        });
        return;
      }

      if (!shop) {
        setAuthState("needs_login");
        return;
      }

      const authed = await isCustomerAuthenticated();
      if (cancelled) return;
      setAuthState(authed ? "authenticated" : "needs_login");
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useFocusEffect(
    useCallback(() => {
      prioritizeCustomerDestination(queryClient, "chat");
      if (!editingMessageRef.current) {
        const draft = getChatDraft(CUSTOMER_CHAT_DRAFT_KEY);
        if (draft && draft !== textRef.current) {
          setText(draft);
        }
      }
      return () => {
        if (!editingMessageRef.current) {
          setChatDraft(CUSTOMER_CHAT_DRAFT_KEY, textRef.current);
        }
      };
    }, [queryClient])
  );

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (!editingMessageRef.current) {
          setChatDraft(CUSTOMER_CHAT_DRAFT_KEY, textRef.current);
        }
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      void (async () => {
        const shopSub = parseShopSubdomainFromUrl(url);
        if (shopSub) {
          await setCustomerShop(shopSub);
          setSelectedShop({ subdomain: shopSub, name: shopSub });
        }

        let tokenValue: string | null = null;
        try {
          const parsed = new URL(url);
          tokenValue =
            parsed.searchParams.get("token") ??
            new URLSearchParams(parsed.hash.replace(/^#/, "")).get("token");
        } catch {
          const hash = url.split("#")[1] ?? "";
          tokenValue = new URLSearchParams(hash).get("token");
        }
        if (tokenValue) setToken(tokenValue);
      })();
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!token) return;
    setVerifying(true);
    (async () => {
      try {
        await api.post("/api/chat/verify", { token }, { role: "customer" });
        setAuthState("authenticated");
        await setCustomerAuthenticated();
        setLoginMessage(null);
      } catch {
        Alert.alert("Error", "Invalid or expired link.");
      } finally {
        setVerifying(false);
        setToken(null);
      }
    })();
  }, [token, setCustomerAuthenticated]);

  const selectChatShop = useCallback(async (shop: SelectedShop) => {
    await setCustomerShop(shop.subdomain, shop.name);
    const profile = await rememberShop(shop.subdomain, shop.name);
    setPastShops(profile.pastShops);
    setSelectedShop(shop);
  }, []);

  const handleChangeShop = useCallback(
    async (shop: SelectedShop) => {
      setChangeShopOpen(false);
      if (selectedShop?.subdomain === shop.subdomain) return;

      clearThreadState();
      try {
        await customerLogout();
      } catch {
        // Best-effort; tenant switch below still clears local session.
      }
      await setCustomerShop(shop.subdomain, shop.name);
      const profile = await rememberShop(shop.subdomain, shop.name);
      setPastShops(profile.pastShops);
      setSelectedShop(shop);
      if (profile.email) setEmail((prev) => prev || profile.email);

      setAuthState("needs_login");
      setLoginMessage(`Sign in again to chat with ${shop.name}.`);
    },
    [selectedShop?.subdomain, clearThreadState, customerLogout]
  );

  const handleRequestLogin = async () => {
    if (!email.trim() || !selectedShop) return;
    setRequestingLogin(true);
    setLoginMessage(null);
    try {
      await setCustomerShop(selectedShop.subdomain, selectedShop.name);
      const { data } = await api.post<{ message?: string }>(
        "/api/chat/request-login",
        { email: email.trim().toLowerCase() },
        { role: "customer" }
      );
      setLoginMessage(
        data.message ??
          "Check your email for a login link. It may take a minute."
      );
    } catch {
      setLoginMessage("Something went wrong. Please try again.");
    } finally {
      setRequestingLogin(false);
    }
  };

  const mergeServerMessages = useCallback((serverMessages: ChatMessage[]) => {
    setMessages((prev) => mergeRecentMessagePage(prev, serverMessages));
  }, []);

  const applyCachedThread = useCallback(() => {
    const cached = readCachedThread(queryClient);
    if (!cached.ready) return false;
    mergeServerMessages(cached.messages);
    setStaffLastReadAt((prev) => prev ?? cached.staffLastReadAt);
    setMessagesReady(true);
    return true;
  }, [mergeServerMessages, queryClient]);

  const messagesReadyRef = useRef(messagesReady);
  messagesReadyRef.current = messagesReady;

  useEffect(() => {
    if (!messagesReady) {
      setLinkPreviewsEnabled(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      setLinkPreviewsEnabled(true);
    });
    return () => task.cancel();
  }, [messagesReady]);

  useEffect(() => {
    if (authState !== "authenticated") {
      if (authState === "needs_login") setMessagesReady(false);
      return;
    }
    // Re-hydrate from React Query when auth flips on (e.g. after magic link),
    // and pick up home→chat prefetch as soon as it lands in the cache.
    applyCachedThread();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.query.queryKey[0] !== CUSTOMER_MESSAGES_QUERY_KEY[0]) return;
      // After the first successful load, fetchMessages owns live updates.
      if (messagesReadyRef.current) return;
      applyCachedThread();
    });
  }, [authState, applyCachedThread, queryClient]);

  const fetchMessages = useCallback(async () => {
    if (authState !== "authenticated") return;
    try {
      // Deep-link to a specific message: load full history so the target exists.
      const path = messageId
        ? customerMessagesPath()
        : customerMessagesPath({ limit: CHAT_MESSAGE_PAGE_SIZE });
      const { data } = await api.get<ChatMessage[] | ChatMessagesPage>(path, {
        role: "customer",
      });
      queryClient.setQueryData(CUSTOMER_MESSAGES_QUERY_KEY, data);
      const { messages: pageMessages, hasMore } = messagesFromPagePayload(data);
      mergeServerMessages(pageMessages);
      if (!Array.isArray(data)) {
        setStaffLastReadAt(data.staffLastReadAt ?? null);
      }
      // Only trust hasMore from limited pages; full history has no older page.
      // Once false, keep it across recent-page polls (those always look "full").
      setHasMoreMessages((prev) => {
        if (messageId) return false;
        if (prev === false) return false;
        return hasMore;
      });
      setMessagesReady(true);
    } catch {
      // Keep the bike loader up on failure — a transient auth/network miss
      // used to flip ready=true and flash "No messages yet" until the 3s
      // poll succeeded. Prefer cache (e.g. home prefetch) when available.
      applyCachedThread();
    }
  }, [
    authState,
    applyCachedThread,
    mergeServerMessages,
    messageId,
    queryClient,
  ]);

  const loadOlderMessages = useCallback(async () => {
    if (
      authState !== "authenticated" ||
      !hasMoreMessages ||
      loadingOlder ||
      messages.length === 0
    ) {
      return;
    }
    const oldest = messages[0];
    if (!oldest || oldest.id.startsWith("temp-")) return;

    setLoadingOlder(true);
    try {
      const { data } = await api.get<ChatMessage[] | ChatMessagesPage>(
        customerMessagesPath({
          limit: CHAT_MESSAGE_PAGE_SIZE,
          before: oldest.id,
        }),
        { role: "customer" }
      );
      const { messages: older, hasMore } = messagesFromPagePayload(data);
      setMessages((prev) => prependOlderMessages(prev, older));
      setHasMoreMessages(hasMore);
    } catch {
      // Leave hasMore true so the user can retry by scrolling up again.
    } finally {
      setLoadingOlder(false);
    }
  }, [
    authState,
    hasMoreMessages,
    loadingOlder,
    messages,
  ]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    const id = setInterval(fetchMessages, POLL_MS);
    return () => clearInterval(id);
  }, [authState, fetchMessages]);

  useEffect(() => {
    if (messageId) {
      pendingScrollToMessageIdRef.current = messageId;
      didInitialAutoScrollRef.current = false;
      return;
    }
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
      flatListRef.current.scrollToEnd({ animated: false });
      didInitialAutoScrollRef.current = true;
      return;
    }

    // Default: land at the latest message. Later image loads keep us pinned
    // via onContentSizeChange while isAtBottomRef remains true.
    flatListRef.current.scrollToEnd({ animated: false });
    didInitialAutoScrollRef.current = true;
  }, [messages.length, scrollToMessageId]);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (isAtBottomRef.current) {
        setTimeout(
          () => flatListRef.current?.scrollToEnd({ animated: true }),
          50
        );
      }
    });
    return () => sub.remove();
  }, []);

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

  const handleSend = useCallback(async () => {
    const textToSend = text.trim();
    const imagesToSend = pendingImages.filter(isPendingChatImageReady);
    if (!textToSend && imagesToSend.length === 0) return;
    if (hasUploadingPendingImages(pendingImages)) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: "",
      sender: "CUSTOMER",
      body: textToSend || null,
      attachments: imagesToSend.map((img) => ({
        id: img.id!,
        url: img.url ?? img.previewUri,
        filename: img.filename,
        mimeType: img.mimeType,
        messageId: null,
        createdAt: new Date().toISOString(),
      })),
      reactions: [],
      createdAt: new Date().toISOString(),
      editedAt: null,
      clientDeliveryState: "SENDING",
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setText("");
    clearChatDraft(CUSTOMER_CHAT_DRAFT_KEY);
    setPendingImages([]);
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
      // Images / multi-line layout can settle a frame later.
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });
    setSending(true);

    try {
      const { data: newMsg } = await api.post<ChatMessage>(
        "/api/chat/conversation/messages",
        {
          body: textToSend || null,
          attachmentIds: imagesToSend.map((p) => p.id!),
        },
        { role: "customer" }
      );
      const deliveredMsg: ChatMessage = { ...newMsg, clientDeliveryState: "DELIVERED" };
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === tempId ? deliveredMsg : m));
        queryClient.setQueryData(CUSTOMER_MESSAGES_QUERY_KEY, (old: MessagesCache | undefined) => {
          if (!old) return next;
          if (Array.isArray(old)) return next;
          return { ...old, messages: next };
        });
        return next;
      });
      clearClientDeliveryStateLater(deliveredMsg.id);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert("Error", "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [text, pendingImages, clearClientDeliveryStateLater, queryClient]);

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.8,
      videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];

    if (isChatVideoAsset(asset)) {
      let pending: PendingChatImage;
      try {
        pending = buildPendingChatVideo(asset);
      } catch (err) {
        Alert.alert(
          "Error",
          err instanceof Error ? err.message : "Failed to prepare video"
        );
        return;
      }
      setPendingImages((prev) => [...prev, pending]);
      try {
        const data = await uploadPendingChatVideo(asset, pending, {
          role: "customer",
        });
        setPendingImages((prev) =>
          prev.map((img) =>
            img.localId === pending.localId
              ? {
                  ...img,
                  id: data.id,
                  url: data.url,
                  filename: data.filename,
                  mimeType: data.mimeType,
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
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to upload video"
        );
      }
      return;
    }

    let pending: PendingChatImage;
    let formData: FormData;
    try {
      ({ pending, formData } = await buildPendingChatImage(asset));
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
        mimeType?: string;
      }>("/api/chat/upload", formData, { role: "customer" });
      setPendingImages((prev) =>
        prev.map((img) =>
          img.localId === pending.localId
            ? {
                ...img,
                id: data.id,
                url: data.url,
                filename: data.filename,
                mimeType: data.mimeType ?? img.mimeType,
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

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      Alert.alert("Delete Message", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(
                `/api/chat/conversation/messages/${messageId}`,
                { role: "customer" }
              );
              fetchMessages();
            } catch {
              Alert.alert("Error", "Failed to delete");
            }
          },
        },
      ]);
    },
    [fetchMessages]
  );

  const startEditing = useCallback((message: ChatMessage) => {
    setEditingMessage(message);
    setText(message.body || "");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingMessage(null);
    setText(getChatDraft(CUSTOMER_CHAT_DRAFT_KEY));
    Keyboard.dismiss();
  }, []);

  const handleEdit = useCallback(async () => {
    if (!editingMessage || !text.trim()) return;
    setSending(true);
    try {
      await api.patch(
        `/api/chat/conversation/messages/${editingMessage.id}`,
        { body: text.trim() },
        { role: "customer" }
      );
      setEditingMessage(null);
      setText(getChatDraft(CUSTOMER_CHAT_DRAFT_KEY));
      fetchMessages();
    } catch {
      Alert.alert("Error", "Failed to edit message");
    } finally {
      setSending(false);
    }
  }, [editingMessage, text, fetchMessages]);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const msg = messages.find((m) => m.id === messageId);
      const myReaction = (msg?.reactions ?? []).find(
        (r) => r.reactorType === "CUSTOMER"
      );
      try {
        if (myReaction?.emoji === emoji) {
          await api.delete(
            `/api/chat/conversation/messages/${messageId}/reactions`,
            { role: "customer" }
          );
        } else {
          await api.post(
            `/api/chat/conversation/messages/${messageId}/reactions`,
            { emoji },
            { role: "customer" }
          );
        }
        fetchMessages();
      } catch {
        // silently fail
      }
    },
    [messages, fetchMessages]
  );

  const lastViewedOwnMsgId = useMemo(() => {
    if (!staffLastReadAt) return null;
    const readTime = new Date(staffLastReadAt).getTime();
    let lastId: string | null = null;
    for (const msg of messages) {
      if (msg.sender === "CUSTOMER" && new Date(msg.createdAt).getTime() <= readTime) {
        lastId = msg.id;
      }
    }
    return lastId;
  }, [messages, staffLastReadAt]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        loginContainer: {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing[6],
          gap: spacing[4],
          backgroundColor: theme.background,
        },
        loaderScreen: {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.background,
        },
        loginTitle: {
          ...fontSize.xl,
          fontWeight: "700",
          color: theme.text,
        },
        loginMessage: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
        },
        loginInput: {
          width: "100%",
          maxWidth: 320,
        },
        loginShop: {
          width: "100%",
          maxWidth: 320,
          gap: spacing[2],
        },
        loginShopLabel: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.textSecondary,
        },
        shopBar: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorder,
          backgroundColor: theme.surface,
        },
        shopBarName: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          flex: 1,
        },
        shopBarChange: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.amber[600],
          paddingVertical: spacing[1],
          paddingHorizontal: spacing[1],
        },
        loginFeedback: {
          ...fontSize.sm,
          color: colors.emerald[600],
          textAlign: "center",
          maxWidth: 320,
        },
        chatContainer: {
          flex: 1,
          backgroundColor: theme.background,
        },
        messageList: {
          padding: spacing[4],
          paddingBottom: spacing[2],
          gap: spacing[2],
          flexGrow: 1,
        },
        emptyChat: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[3],
          paddingVertical: spacing[16],
        },
        emptyText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
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
          backgroundColor: colors.amber[500],
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
          color: theme.dark ? colors.amber[400] : colors.amber[700],
        },
        bubbleMeta: {
          ...fontSize.xs,
          alignSelf: "flex-end",
        },
        bubbleMetaOwn: {
          color: colors.amber[100],
        },
        bubbleMetaOther: {
          color: theme.textMuted,
        },
        imageMessage: {
          gap: spacing[1],
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
        pendingRow: {
          flexDirection: "row",
          gap: spacing[2],
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          backgroundColor: theme.background,
        },
        pendingWrapper: { position: "relative" },
        pendingImg: {
          width: 60,
          height: 60,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.surfaceBorder,
        },
        pendingVideo: {
          backgroundColor: "#111",
          alignItems: "center",
          justifyContent: "center",
        },
        pendingUploading: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: "rgba(0,0,0,0.35)",
          borderRadius: borderRadius.lg,
          justifyContent: "center",
          alignItems: "center",
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
        editBanner: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          backgroundColor: theme.dark
            ? colors.amber[800] + "55"
            : colors.amber[50],
          borderTopWidth: 1,
          borderTopColor: theme.dark
            ? colors.amber[700]
            : colors.amber[100],
        },
        editBannerContent: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1.5],
        },
        editBannerText: {
          ...fontSize.sm,
          color: theme.dark ? colors.amber[400] : colors.amber[700],
          fontWeight: "500",
        },
        composer: {
          flexDirection: "row",
          alignItems: "flex-end",
          gap: spacing[2],
          paddingTop: spacing[3],
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[3] + insets.bottom,
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
          backgroundColor: theme.background,
        },
        imageButton: { padding: spacing[2] },
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
          backgroundColor: colors.amber[500],
          justifyContent: "center",
          alignItems: "center",
        },
        sendDisabled: { opacity: 0.5 },
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
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing[1],
          paddingVertical: 2,
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: theme.dark ? 0.35 : 0.15,
          shadowRadius: 3,
          elevation: 3,
        },
        reactionPillMine: {
          backgroundColor: theme.dark
            ? colors.emerald[800] + "55"
            : colors.emerald[50],
          borderColor: theme.dark
            ? colors.emerald[600]
            : colors.emerald[300],
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
          backgroundColor: theme.dark
            ? colors.emerald[800] + "55"
            : colors.emerald[100],
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
    [theme, insets.bottom]
  );

  if ((authState === "loading" || verifying) && !messagesReady) {
    return (
      <View style={styles.loaderScreen}>
        <BikeLoader label={verifying ? "Signing you in…" : "Loading chat…"} />
      </View>
    );
  }

  if (authState === "needs_login") {
    const loginCopy = selectedShop
      ? `We'll send a login link for ${selectedShop.name}.`
      : "Choose your bike shop, then enter your email for a login link.";
    return (
      <>
        <Stack.Screen options={{ title: "Chat" }} />
        <View style={styles.loginContainer}>
          <Ionicons
            name="chatbubbles-outline"
            size={48}
            color={theme.iconMuted}
          />
          <Text style={styles.loginTitle}>Chat with us</Text>
          <Text style={styles.loginMessage}>{loginCopy}</Text>
          <View style={styles.loginShop}>
            <Text style={styles.loginShopLabel}>Bike Shop</Text>
            <ShopPicker
              pastShops={pastShops}
              selectedShop={selectedShop}
              onSelect={selectChatShop}
              hint={
                selectedShop
                  ? "Change shop if you need to chat with a different one."
                  : undefined
              }
            />
          </View>
          <Input
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            containerStyle={styles.loginInput}
          />
          <Button
            title={requestingLogin ? "Sending..." : "Send Login Link"}
            onPress={handleRequestLogin}
            loading={requestingLogin}
            disabled={!email.trim() || !selectedShop}
          />
          {loginMessage ? (
            <Text style={styles.loginFeedback}>{loginMessage}</Text>
          ) : null}
        </View>
      </>
    );
  }

  // Authenticated path — paint chat chrome immediately. Cached threads already
  // have messagesReady=true so revisits skip the empty-state spinner.
  return (
    <>
      <Stack.Screen options={{ title: "Chat" }} />
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        {selectedShop ? (
          <View style={styles.shopBar}>
            <Text style={styles.shopBarName} numberOfLines={1}>
              {selectedShop.name}
            </Text>
            <TouchableOpacity onPress={() => setChangeShopOpen(true)}>
              <Text style={styles.shopBarChange}>Change</Text>
            </TouchableOpacity>
          </View>
        ) : null}
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
          onLayout={() => {
            requestAnimationFrame(() => ensureInitialScroll());
          }}
          onScrollToIndexFailed={(info) => {
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
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              {!messagesReady ? (
                <SectionLoader label="Loading messages…" />
              ) : (
                <Text style={styles.emptyText}>
                  No messages yet. Say hello!
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const isOwn = item.sender === "CUSTOMER";
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
                  <View style={styles.imageMessage}>
                    {item.attachments?.map(
                      (att: { id: string; url: string; mimeType?: string }) => (
                        <ChatAttachmentMedia
                          key={att.id}
                          url={resolveCustomerUrl(att.url)}
                          mimeType={att.mimeType}
                          style={styles.standaloneImage}
                          onPress={() => {
                            const resolved = resolveCustomerUrl(att.url);
                            if (isVideoMimeType(att.mimeType)) {
                              setViewingVideoUrl(resolved);
                            } else {
                              setViewingImageUrl(resolved);
                            }
                          }}
                          onLongPress={() => setActiveMessage(item)}
                        />
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
                        ? styles.imageMessage
                        : [
                            styles.bubble,
                            isOwn ? styles.bubbleOwn : styles.bubbleOther,
                          ]
                    }
                  >
                    {item.attachments?.map(
                      (att: { id: string; url: string; mimeType?: string }) => (
                        <ChatAttachmentMedia
                          key={att.id}
                          url={resolveCustomerUrl(att.url)}
                          mimeType={att.mimeType}
                          style={styles.standaloneImage}
                          onPress={() => {
                            const resolved = resolveCustomerUrl(att.url);
                            if (isVideoMimeType(att.mimeType)) {
                              setViewingVideoUrl(resolved);
                            } else {
                              setViewingImageUrl(resolved);
                            }
                          }}
                          onLongPress={() => setActiveMessage(item)}
                        />
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
                        (r) =>
                          r.emoji === emoji && r.reactorType === "CUSTOMER"
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
              <View key={p.localId} style={styles.pendingWrapper}>
                {p.kind === "video" ? (
                  <View style={[styles.pendingImg, styles.pendingVideo]}>
                    <Ionicons name="videocam" size={22} color={colors.white} />
                  </View>
                ) : (
                  <Image
                    source={{ uri: pendingChatImageDisplayUri(p) }}
                    style={styles.pendingImg}
                    resizeMode="cover"
                  />
                )}
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
              <Ionicons name="pencil" size={14} color={colors.amber[600]} />
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
            value={text}
            measureText={text}
            onChangeText={(next) => {
              setText(next);
              if (!editingMessage) {
                setChatDraft(CUSTOMER_CHAT_DRAFT_KEY, next);
              }
            }}
            placeholder={editingMessage ? "Edit message..." : "Type a message..."}
            shellStyle={styles.inputShell}
            style={styles.input}
            placeholderTextColor={theme.textMuted}
          />
          <TouchableOpacity
            onPress={editingMessage ? handleEdit : handleSend}
            disabled={
              sending ||
              hasUploadingPendingImages(pendingImages) ||
              (!text.trim() &&
                !editingMessage &&
                pendingImages.filter(isPendingChatImageReady).length === 0)
            }
            style={[
              styles.sendButton,
              (sending ||
                hasUploadingPendingImages(pendingImages) ||
                (!text.trim() &&
                  !editingMessage &&
                  pendingImages.filter(isPendingChatImageReady).length === 0)) &&
                styles.sendDisabled,
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
      <VideoViewer uri={viewingVideoUrl} onClose={() => setViewingVideoUrl(null)} />

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
                  (r) => r.reactorType === "CUSTOMER"
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
            {activeMessage?.sender === "CUSTOMER" ? (
              <>
                <View style={styles.popupDivider} />
                {activeMessage?.body ? (
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
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      <ShopPickerModal
        visible={changeShopOpen}
        pastShops={pastShops}
        selectedShop={selectedShop}
        onClose={() => setChangeShopOpen(false)}
        onSelect={handleChangeShop}
      />
    </>
  );
}
