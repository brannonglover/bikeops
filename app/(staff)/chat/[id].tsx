import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  StyleSheet,
  Alert,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/lib/api";
import { type ChatMessage, type Conversation } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { customerName, formatTime } from "@/lib/format";

const POLL_MS = 3000;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const flatListRef = useRef<FlatList>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<
    { id: string; url: string; filename: string }[]
  >([]);

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
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

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

  if (isLoading) return <LoadingScreen message="Loading messages..." />;

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
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => {
            const isOwn = item.sender === "STAFF";
            return (
              <TouchableOpacity
                onLongPress={isOwn ? () => handleDeleteMessage(item.id) : undefined}
                activeOpacity={0.8}
                style={[
                  styles.bubble,
                  isOwn ? styles.bubbleOwn : styles.bubbleOther,
                ]}
              >
                {item.attachments?.map((att: { id: string; url: string }) => (
                  <Image
                    key={att.id}
                    source={{ uri: att.url }}
                    style={styles.attachmentImage}
                  />
                ))}
                {item.body ? (
                  <Text
                    style={[
                      styles.bubbleText,
                      isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther,
                    ]}
                  >
                    {item.body}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.bubbleMeta,
                    isOwn ? styles.bubbleMetaOwn : styles.bubbleMetaOther,
                  ]}
                >
                  {formatTime(item.createdAt)}
                  {item.editedAt ? " (edited)" : ""}
                </Text>
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            isCustomerTyping ? (
              <Text style={styles.typing}>Customer is typing...</Text>
            ) : null
          }
        />

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

        <View style={styles.composer}>
          <TouchableOpacity onPress={handlePickImage} style={styles.imageButton}>
            <Ionicons name="image-outline" size={24} color={colors.slate[500]} />
          </TouchableOpacity>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            style={styles.input}
            placeholderTextColor={colors.slate[400]}
            multiline
            maxLength={5000}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || (!text.trim() && pendingImages.length === 0)}
            style={[
              styles.sendButton,
              (sending || (!text.trim() && pendingImages.length === 0)) &&
                styles.sendButtonDisabled,
            ]}
          >
            <Ionicons name="send" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  messageList: {
    padding: spacing[4],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  bubble: {
    maxWidth: "80%",
    padding: spacing[3],
    borderRadius: borderRadius["2xl"],
    gap: spacing[1],
  },
  bubbleOwn: {
    alignSelf: "flex-end",
    backgroundColor: colors.emerald[600],
    borderBottomRightRadius: borderRadius.md,
  },
  bubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: colors.slate[100],
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
    color: colors.slate[900],
  },
  bubbleMeta: {
    ...fontSize.xs,
    alignSelf: "flex-end",
  },
  bubbleMetaOwn: {
    color: colors.emerald[200],
  },
  bubbleMetaOther: {
    color: colors.slate[400],
  },
  attachmentImage: {
    width: 200,
    height: 200,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[200],
  },
  typing: {
    ...fontSize.sm,
    color: colors.slate[500],
    fontStyle: "italic",
    paddingVertical: spacing[2],
  },
  pendingRow: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.slate[50],
  },
  pendingImageWrapper: {
    position: "relative",
  },
  pendingImage: {
    width: 60,
    height: 60,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[200],
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
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
    padding: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.slate[200],
    backgroundColor: colors.slate[50],
  },
  imageButton: {
    padding: spacing[2],
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.slate[300],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    ...fontSize.sm,
    color: colors.slate[900],
    backgroundColor: colors.white,
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
});
