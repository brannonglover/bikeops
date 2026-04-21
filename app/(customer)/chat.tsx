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
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Stack } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { api, isCustomerAuthenticated, resolveUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type ChatMessage } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { LinkifiedText } from "@/components/chat/LinkifiedText";
import { LinkPreview } from "@/components/chat/LinkPreview";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_REGEX) ?? []));
}
import { formatTime } from "@/lib/format";

const POLL_MS = 3000;
const REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

type AuthState = "loading" | "needs_login" | "authenticated";

export default function CustomerChatScreen() {
  const { theme } = useTheme();
  const { setCustomerAuthenticated } = useAuth();
  const headerHeight = useHeaderHeight();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [email, setEmail] = useState("");
  const [requestingLogin, setRequestingLogin] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [staffLastReadAt, setStaffLastReadAt] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<
    { id: string; url: string; filename: string }[]
  >([]);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);

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

  useEffect(() => {
    isCustomerAuthenticated().then((authed) =>
      setAuthState(authed ? "authenticated" : "needs_login")
    );
  }, []);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      const hash = url.split("#")[1] ?? "";
      const params = new URLSearchParams(hash);
      const t = params.get("token");
      if (t) setToken(t);
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
    api
      .post("/api/chat/verify", { token }, { role: "customer" })
      .then(() => {
        setAuthState("authenticated");
        setCustomerAuthenticated();
      })
      .catch(() => Alert.alert("Error", "Invalid or expired link."))
      .finally(() => {
        setVerifying(false);
        setToken(null);
      });
  }, [token, setCustomerAuthenticated]);

  const mergeServerMessages = useCallback((serverMessages: ChatMessage[]) => {
    setMessages((prev) => {
      const prevById = new Map(prev.map((m) => [m.id, m]));
      const merged = serverMessages.map((m) => {
        const prevMsg = prevById.get(m.id);
        return prevMsg?.clientDeliveryState
          ? { ...m, clientDeliveryState: prevMsg.clientDeliveryState }
          : m;
      });

      const serverIds = new Set(serverMessages.map((m) => m.id));
      const optimistic = prev.filter(
        (m) => m.id.startsWith("temp-") && !serverIds.has(m.id)
      );
      return [...merged, ...optimistic];
    });
  }, []);

  const fetchMessages = useCallback(async () => {
    if (authState !== "authenticated") return;
    try {
      const { data } = await api.get<
        | ChatMessage[]
        | { messages: ChatMessage[]; staffLastReadAt: string | null }
      >("/api/chat/conversation/messages", { role: "customer" });
      if (Array.isArray(data)) {
        mergeServerMessages(data);
      } else {
        mergeServerMessages(data.messages ?? []);
        setStaffLastReadAt(data.staffLastReadAt ?? null);
      }
    } catch {
      // ignore
    }
  }, [authState, mergeServerMessages]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    const id = setInterval(fetchMessages, POLL_MS);
    return () => clearInterval(id);
  }, [authState, fetchMessages]);

  useEffect(() => {
    if (messages.length > 0 && isAtBottomRef.current) {
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: false }),
        100
      );
    }
  }, [messages.length]);

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
    },
    []
  );

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleRequestLogin = async () => {
    if (!email.trim()) return;
    setRequestingLogin(true);
    setLoginMessage(null);
    try {
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

  const handleSend = useCallback(async () => {
    const textToSend = text.trim();
    const imagesToSend = [...pendingImages];
    if (!textToSend && imagesToSend.length === 0) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: "",
      sender: "CUSTOMER",
      body: textToSend || null,
      attachments: imagesToSend.map((img) => ({
        id: img.id,
        url: img.url,
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

    setMessages((prev) => [...prev, optimisticMsg]);
    setText("");
    setPendingImages([]);
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    setSending(true);

    try {
      const { data: newMsg } = await api.post<ChatMessage>(
        "/api/chat/conversation/messages",
        {
          body: textToSend || null,
          attachmentIds: imagesToSend.map((p) => p.id),
        },
        { role: "customer" }
      );
      const deliveredMsg: ChatMessage = { ...newMsg, clientDeliveryState: "DELIVERED" };
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? deliveredMsg : m))
      );
      clearClientDeliveryStateLater(deliveredMsg.id);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert("Error", "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [text, pendingImages, clearClientDeliveryStateLater]);

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const isHeic =
      asset.mimeType === "image/heic" || asset.mimeType === "image/heif";
    const mimeType = isHeic ? "image/jpeg" : (asset.mimeType ?? "image/jpeg");
    const fileName = isHeic
      ? (asset.fileName?.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg") ?? "photo.jpg")
      : (asset.fileName ?? "photo.jpg");
    const formData = new FormData();
    formData.append("file", {
      uri: asset.uri,
      type: mimeType,
      name: fileName,
    } as unknown as Blob);
    try {
      const { data } = await api.postForm<{
        id: string;
        url: string;
        filename: string;
      }>("/api/chat/upload", formData, { role: "customer" });
      setPendingImages((prev) => [...prev, data]);
    } catch {
      Alert.alert("Error", "Failed to upload image");
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
    setText("");
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
      setText("");
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

  const handleLogout = async () => {
    try {
      await api.post("/api/chat/logout", undefined, { role: "customer" });
    } catch {
      // ignore
    }
    setAuthState("needs_login");
    setMessages([]);
  };

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
          color: colors.amber[700],
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
          backgroundColor: colors.amber[50],
          borderTopWidth: 1,
          borderTopColor: colors.amber[100],
        },
        editBannerContent: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1.5],
        },
        editBannerText: {
          ...fontSize.sm,
          color: colors.amber[700],
          fontWeight: "500",
        },
        composer: {
          flexDirection: "row",
          alignItems: "flex-end",
          gap: spacing[2],
          padding: spacing[3],
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
          backgroundColor: theme.background,
        },
        imageButton: { padding: spacing[2] },
        input: {
          flex: 1,
          borderWidth: 1,
          borderColor: theme.inputBorder,
          borderRadius: borderRadius.xl,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          ...fontSize.sm,
          color: theme.inputText,
          backgroundColor: theme.inputBg,
          maxHeight: 100,
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
          backgroundColor: colors.white,
          borderWidth: 1,
          borderColor: colors.slate[200],
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
          backgroundColor: colors.emerald[50],
          borderColor: colors.emerald[300],
        },
        reactionPillEmoji: {
          fontSize: 14,
        },
        reactionPillCount: {
          ...fontSize.xs,
          color: colors.slate[600],
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
          backgroundColor: colors.emerald[100],
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

  if (authState === "loading" || verifying) {
    return <LoadingScreen message="Loading chat..." />;
  }

  if (authState === "needs_login") {
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
          <Text style={styles.loginMessage}>
            Enter your email to receive a login link.
          </Text>
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
            disabled={!email.trim()}
          />
          {loginMessage ? (
            <Text style={styles.loginFeedback}>{loginMessage}</Text>
          ) : null}
        </View>
      </>
    );
  }

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

  return (
    <>
      <Stack.Screen
        options={{
          title: "Chat",
          headerRight: () => (
            <TouchableOpacity onPress={handleLogout} style={{ padding: spacing[2] }}>
              <Ionicons name="log-out-outline" size={20} color={theme.icon} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          scrollEventThrottle={100}
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
                      <LinkPreview key={url} url={url} />
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
              <View key={p.id} style={styles.pendingWrapper}>
                <Image source={{ uri: p.url }} style={styles.pendingImg} />
                <TouchableOpacity
                  onPress={() =>
                    setPendingImages((prev) => prev.filter((i) => i.id !== p.id))
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
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={editingMessage ? "Edit message..." : "Type a message..."}
            style={styles.input}
            placeholderTextColor={theme.textMuted}
            multiline
          />
          <TouchableOpacity
            onPress={editingMessage ? handleEdit : handleSend}
            disabled={sending || (!text.trim() && !editingMessage && pendingImages.length === 0)}
            style={[
              styles.sendButton,
              (sending || (!text.trim() && !editingMessage && pendingImages.length === 0)) &&
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
    </>
  );
}
