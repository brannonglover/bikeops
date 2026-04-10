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
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api, resolveUrl } from "@/lib/api";
import { type ChatMessage, type Conversation } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { LinkifiedText } from "@/components/chat/LinkifiedText";
import { LinkPreview } from "@/components/chat/LinkPreview";

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

const POLL_MS = 3000;
const REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

export default function ConversationScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = paramToString(params.id);
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<
    { id: string; url: string; filename: string }[]
  >([]);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);

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
        standaloneImage: {
          width: 220,
          height: 220,
          borderRadius: borderRadius.xl,
        },
        inlineImage: {
          width: 200,
          height: 200,
          borderRadius: borderRadius.lg,
        },
        imageMetaText: {
          ...fontSize.xs,
          color: theme.textMuted,
          alignSelf: "flex-end",
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
        editBanner: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          backgroundColor: colors.emerald[50],
          borderTopWidth: 1,
          borderTopColor: colors.emerald[200],
        },
        editBannerContent: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1.5],
        },
        editBannerText: {
          ...fontSize.sm,
          color: colors.emerald[700],
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
        imageButton: {
          padding: spacing[2],
        },
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
          backgroundColor: colors.white,
          borderWidth: 1,
          borderColor: colors.slate[200],
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
          backgroundColor: colors.slate[200],
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

  const {
    data: messagesData,
    isLoading,
    isError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ["messages", id],
    queryFn: async () => {
      const { data } = await api.get<
        | ChatMessage[]
        | {
            messages: ChatMessage[];
            customerTypingAt: string | null;
            customerLastReadAt: string | null;
            staffLastReadAt: string | null;
          }
      >(`/api/conversations/${id}/messages`);
      return data;
    },
    enabled: !!id,
    refetchInterval: POLL_MS,
  });

  const messages: ChatMessage[] = Array.isArray(messagesData)
    ? messagesData
    : messagesData?.messages ?? [];

  const customerTypingAt = !Array.isArray(messagesData)
    ? messagesData?.customerTypingAt
    : null;
  const isCustomerTyping =
    customerTypingAt &&
    Date.now() - new Date(customerTypingAt).getTime() < 8000;

  useEffect(() => {
    if (messages.length > 0 && isAtBottomRef.current) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (isAtBottomRef.current) {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
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

  const handleSend = useCallback(async () => {
    if (!text.trim() && pendingImages.length === 0) return;
    setSending(true);
    try {
      await api.post(`/api/conversations/${id}/messages`, {
        sender: "STAFF",
        body: text.trim() || null,
        attachmentIds: pendingImages.map((p) => p.id),
      });
      setText("");
      setPendingImages([]);
      isAtBottomRef.current = true;
      setShowScrollButton(false);
      queryClient.invalidateQueries({ queryKey: ["messages", id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      Alert.alert("Error", "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [id, text, pendingImages, queryClient]);

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const formData = new FormData();
    formData.append("file", {
      uri: asset.uri,
      type: asset.mimeType ?? "image/jpeg",
      name: asset.fileName ?? "photo.jpg",
    } as unknown as Blob);
    try {
      const { data } = await api.postForm<{
        id: string;
        url: string;
        filename: string;
      }>("/api/chat/upload", formData);
      setPendingImages((prev) => [...prev, data]);
    } catch {
      Alert.alert("Error", "Failed to upload image");
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
        `/api/conversations/${id}/messages/${editingMessage.id}`,
        { body: text.trim() }
      );
      setEditingMessage(null);
      setText("");
      queryClient.invalidateQueries({ queryKey: ["messages", id] });
    } catch {
      Alert.alert("Error", "Failed to edit message");
    } finally {
      setSending(false);
    }
  }, [editingMessage, text, id, queryClient]);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const msg = messages.find((m) => m.id === messageId);
      const myReaction = (msg?.reactions ?? []).find(
        (r) => r.reactorType === "STAFF"
      );
      try {
        if (myReaction?.emoji === emoji) {
          await api.delete(
            `/api/conversations/${id}/messages/${messageId}/reactions`
          );
        } else {
          await api.post(
            `/api/conversations/${id}/messages/${messageId}/reactions`,
            { emoji }
          );
        }
        queryClient.invalidateQueries({ queryKey: ["messages", id] });
      } catch {
        // silently fail
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

  if (isLoading) return <LoadingScreen message="Loading messages..." />;

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
          title: conversation
            ? customerName(conversation.customer)
            : "Conversation",
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
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
            const isOwn = item.sender === "STAFF";
            const imageOnly =
              (item.attachments?.length ?? 0) > 0 && !item.body;
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
                  {item.attachments?.map((att: { id: string; url: string }) => (
                    <TouchableOpacity
                      key={att.id}
                      activeOpacity={0.8}
                      onPress={() => setViewingImageUrl(resolveUrl(att.url))}
                      onLongPress={() => setActiveMessage(item)}
                    >
                      <Image
                        source={{ uri: resolveUrl(att.url) }}
                        style={
                          imageOnly
                            ? styles.standaloneImage
                            : styles.inlineImage
                        }
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ))}
                  {item.body ? (
                    <LinkifiedText
                      text={item.body}
                      style={[
                        styles.bubbleText,
                        isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther,
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
              <View key={p.id} style={styles.pendingImageWrapper}>
                <Image
                  source={{ uri: p.url }}
                  style={styles.pendingImage}
                />
                <TouchableOpacity
                  onPress={() =>
                    setPendingImages((prev) =>
                      prev.filter((i) => i.id !== p.id)
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
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={editingMessage ? "Edit message..." : "Type a message..."}
            style={styles.input}
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={5000}
            onSubmitEditing={editingMessage ? handleEdit : handleSend}
          />
          <TouchableOpacity
            onPress={editingMessage ? handleEdit : handleSend}
            disabled={sending || (!text.trim() && !editingMessage && pendingImages.length === 0)}
            style={[
              styles.sendButton,
              (sending || (!text.trim() && !editingMessage && pendingImages.length === 0)) &&
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
    </>
  );
}
