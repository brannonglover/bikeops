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
  Linking,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { api, isCustomerAuthenticated } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type ChatMessage } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatTime } from "@/lib/format";

const POLL_MS = 3000;

type AuthState = "loading" | "needs_login" | "authenticated";

export default function CustomerChatScreen() {
  const router = useRouter();
  const { setCustomerAuthenticated } = useAuth();
  const flatListRef = useRef<FlatList>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [email, setEmail] = useState("");
  const [requestingLogin, setRequestingLogin] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<
    { id: string; url: string; filename: string }[]
  >([]);

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

  const fetchMessages = useCallback(async () => {
    if (authState !== "authenticated") return;
    try {
      const { data } = await api.get<
        ChatMessage[] | { messages: ChatMessage[] }
      >("/api/chat/conversation/messages", { role: "customer" });
      const msgs = Array.isArray(data) ? data : data.messages ?? [];
      setMessages(msgs);
    } catch {
      // ignore
    }
  }, [authState]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    const id = setInterval(fetchMessages, POLL_MS);
    return () => clearInterval(id);
  }, [authState, fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: false }),
        100
      );
    }
  }, [messages.length]);

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
    if (!text.trim() && pendingImages.length === 0) return;
    setSending(true);
    try {
      await api.post(
        "/api/chat/conversation/messages",
        {
          body: text.trim() || null,
          attachmentIds: pendingImages.map((p) => p.id),
        },
        { role: "customer" }
      );
      setText("");
      setPendingImages([]);
      fetchMessages();
    } catch {
      Alert.alert("Error", "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [text, pendingImages, fetchMessages]);

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
      }>("/api/chat/upload", formData, { role: "customer" });
      setPendingImages((prev) => [...prev, data]);
    } catch {
      Alert.alert("Error", "Failed to upload image");
    }
  };

  const handleLogout = async () => {
    try {
      await api.post("/api/chat/logout", undefined, { role: "customer" });
    } catch {
      // ignore
    }
    setAuthState("needs_login");
    setMessages([]);
  };

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
            color={colors.slate[300]}
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

  return (
    <>
      <Stack.Screen
        options={{
          title: "Chat",
          headerRight: () => (
            <TouchableOpacity onPress={handleLogout} style={{ padding: spacing[2] }}>
              <Ionicons name="log-out-outline" size={20} color={colors.slate[500]} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => {
            const isOwn = item.sender === "CUSTOMER";
            return (
              <View
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
                </Text>
              </View>
            );
          }}
        />

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
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || (!text.trim() && pendingImages.length === 0)}
            style={[
              styles.sendButton,
              (sending || (!text.trim() && pendingImages.length === 0)) &&
                styles.sendDisabled,
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
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[6],
    gap: spacing[4],
    backgroundColor: colors.white,
  },
  loginTitle: {
    ...fontSize.xl,
    fontWeight: "700",
    color: colors.slate[900],
  },
  loginMessage: {
    ...fontSize.sm,
    color: colors.slate[500],
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
    backgroundColor: colors.amber[500],
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
    color: colors.amber[100],
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
  pendingRow: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.slate[50],
  },
  pendingWrapper: { position: "relative" },
  pendingImg: {
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
  imageButton: { padding: spacing[2] },
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
    backgroundColor: colors.amber[500],
    justifyContent: "center",
    alignItems: "center",
  },
  sendDisabled: { opacity: 0.5 },
});
