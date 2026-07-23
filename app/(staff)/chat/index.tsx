import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Conversation, type Customer } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { BikeLoader } from "@/components/ui/BikeLoader";
import {
  conversationsQueryKey,
  fetchStaffConversations,
  prefetchConversationMessages,
} from "@/lib/staff-queries";
import { customerName, formatDateTime } from "@/lib/format";

function paramToString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length > 0 ? s : undefined;
}

/** Prefer job thread from a job deep link, then general (no job), then any for this customer. */
function pickConversationForCustomer(
  list: Conversation[],
  customerId: string,
  jobId?: string
): Conversation | undefined {
  if (jobId) {
    const forJob = list.find(
      (c) => c.customerId === customerId && c.jobId === jobId
    );
    if (forJob) return forJob;
  }
  const general = list.find(
    (c) => c.customerId === customerId && !c.jobId
  );
  if (general) return general;
  return list.find((c) => c.customerId === customerId);
}

export default function ChatListScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    customer?: string | string[];
    jobId?: string | string[];
  }>();
  const customerId = paramToString(params.customer);
  const jobId = paramToString(params.jobId);
  const queryClient = useQueryClient();
  const [showNewModal, setShowNewModal] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const hasNavigatedRef = useRef(false);

  const {
    data: conversations = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: conversationsQueryKey,
    queryFn: fetchStaffConversations,
    refetchInterval: 15_000,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (!customerId || hasNavigatedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        type CustomerConvPreview = { conversation: { id: string } | null };
        const { data: preview } = await api.get<CustomerConvPreview>(
          `/api/conversations/by-customer/${customerId}`
        );
        if (cancelled || hasNavigatedRef.current) return;
        if (preview?.conversation?.id) {
          hasNavigatedRef.current = true;
          router.push(`/(staff)/chat/${preview.conversation.id}`);
          return;
        }
        const { data: newConv } = await api.post<Conversation>(
          "/api/conversations",
          { customerId, jobId: null }
        );
        if (cancelled || hasNavigatedRef.current) return;
        hasNavigatedRef.current = true;
        router.push(`/(staff)/chat/${newConv.id}`);
      } catch {
        // fall back to normal list-based behavior below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, router]);

  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  useEffect(() => {
    if (
      !customerId ||
      (isLoading && conversations.length === 0) ||
      hasNavigatedRef.current
    )
      return;
    const existing = pickConversationForCustomer(
      conversations,
      customerId,
      jobId
    );
    if (existing) {
      hasNavigatedRef.current = true;
      router.push(`/(staff)/chat/${existing.id}`);
    }
  }, [customerId, jobId, conversations, isLoading, router]);

  const openNewModal = async () => {
    setShowNewModal(true);
    setSearch("");
    try {
      const { data } = await api.get<Customer[]>("/api/customers");
      setCustomers(data);
    } catch {
      setCustomers([]);
    }
  };

  const selectCustomer = async (customerId: string) => {
    const existing = pickConversationForCustomer(conversations, customerId);
    if (existing) {
      setShowNewModal(false);
      router.push(`/(staff)/chat/${existing.id}`);
      return;
    }
    try {
      const { data: newConv } = await api.post<Conversation>(
        "/api/conversations",
        { customerId }
      );
      setShowNewModal(false);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/(staff)/chat/${newConv.id}`);
    } catch {
      Alert.alert("Error", "Failed to create conversation");
    }
  };

  const archiveConversation = async (id: string) => {
    try {
      await api.patch(`/api/conversations/${id}`, { archived: true });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      Alert.alert("Error", "Failed to archive");
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = search.toLowerCase();
    const name = `${c.firstName} ${c.lastName || ""}`.toLowerCase();
    return (
      name.includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q)
    );
  });

  const showInitialLoad = isLoading && conversations.length === 0;

  const getLastMessage = (conv: Conversation) => {
    if (!conv.messages || conv.messages.length === 0) return null;
    return conv.messages[conv.messages.length - 1];
  };

  const hasUnread = (conv: Conversation) => {
    const lastMsg = getLastMessage(conv);
    if (!lastMsg || lastMsg.sender !== "CUSTOMER") return false;
    if (!conv.staffLastReadAt) return true;
    return new Date(lastMsg.createdAt) > new Date(conv.staffLastReadAt);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.toolbar,
          {
            backgroundColor: theme.surface,
            borderBottomColor: theme.surfaceBorder,
          },
        ]}
      >
        <TouchableOpacity onPress={openNewModal} style={styles.newButton}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newButtonText}>New conversation</Text>
        </TouchableOpacity>
      </View>

      {showInitialLoad ? (
        <View style={styles.initialLoad}>
          <BikeLoader label="Loading conversations…" />
        </View>
      ) : conversations.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No conversations"
          message="Start a conversation with a customer."
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
          }
          renderItem={({ item }) => {
            const lastMsg = getLastMessage(item);
            const unread = hasUnread(item);
            return (
              <TouchableOpacity
                onPressIn={() => {
                  void prefetchConversationMessages(queryClient, item.id);
                }}
                onPress={() => router.push(`/(staff)/chat/${item.id}`)}
                onLongPress={() => {
                  Alert.alert("Archive", "Archive this conversation?", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Archive",
                      onPress: () => archiveConversation(item.id),
                    },
                  ]);
                }}
                style={[
                  styles.row,
                  { borderBottomColor: theme.surfaceBorderSubtle },
                  unread && {
                    backgroundColor: theme.dark
                      ? colors.emerald[800] + "30"
                      : colors.emerald[50] + "40",
                  },
                ]}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: theme.dark ? colors.slate[600] : colors.slate[400] },
                  ]}
                >
                  <Ionicons
                    name="person"
                    size={20}
                    color={colors.white}
                  />
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowHeader}>
                    <Text
                      style={[
                        styles.rowName,
                        { color: theme.text },
                        unread && styles.rowNameBold,
                      ]}
                      numberOfLines={1}
                    >
                      {customerName(item.customer)}
                      {item.job
                        ? ` · ${item.job.bikeMake} ${item.job.bikeModel}`
                        : ""}
                    </Text>
                    {lastMsg ? (
                      <Text style={[styles.rowTime, { color: theme.textMuted }]}>
                        {formatDateTime(lastMsg.createdAt)}
                      </Text>
                    ) : null}
                  </View>
                  {lastMsg ? (
                    <Text
                      style={[
                        styles.rowPreview,
                        { color: theme.textSecondary },
                        unread && { fontWeight: "500", color: theme.textTertiary },
                      ]}
                      numberOfLines={1}
                    >
                      {lastMsg.sender === "STAFF" ? "You: " : ""}
                      {lastMsg.body || "(image)"}
                    </Text>
                  ) : (
                    <Text style={[styles.rowPreview, { color: theme.textSecondary }]}>
                      No messages yet
                    </Text>
                  )}
                </View>
                {unread ? <View style={styles.unreadDot} /> : null}
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal
        visible={showNewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNewModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.surface }]}>
          <View
            style={[
              styles.modalHeader,
              { borderBottomColor: theme.surfaceBorder },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              Start conversation
            </Text>
            <TouchableOpacity onPress={() => setShowNewModal(false)}>
              <Ionicons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, email, or phone..."
            style={[
              styles.searchInput,
              {
                borderColor: theme.inputBorder,
                backgroundColor: theme.inputBg,
                color: theme.inputText,
              },
            ]}
            placeholderTextColor={theme.textMuted}
          />
          <FlatList
            data={filteredCustomers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => selectCustomer(item.id)}
                style={[
                  styles.customerOption,
                  { borderBottomColor: theme.surfaceBorderSubtle },
                ]}
              >
                <Text style={[styles.customerName, { color: theme.text }]}>
                  {customerName(item)}
                </Text>
                {item.email ? (
                  <Text style={[styles.customerEmail, { color: theme.textSecondary }]}>
                    {item.email}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                No customers found
              </Text>
            }
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  initialLoad: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing[12],
  },
  toolbar: {
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    paddingVertical: spacing[2],
    backgroundColor: colors.slate[700],
    borderRadius: borderRadius.lg,
  },
  newButtonText: {
    ...fontSize.sm,
    fontWeight: "500",
    color: colors.white,
  },
  listContent: {
    paddingBottom: spacing[12],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing[3],
    gap: spacing[3],
    borderBottomWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowName: {
    ...fontSize.sm,
    flex: 1,
  },
  rowNameBold: {
    fontWeight: "600",
  },
  rowTime: {
    ...fontSize.xs,
    marginLeft: spacing[2],
  },
  rowPreview: {
    ...fontSize.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.emerald[500],
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[4],
    borderBottomWidth: 1,
  },
  modalTitle: {
    ...fontSize.lg,
    fontWeight: "600",
  },
  searchInput: {
    margin: spacing[4],
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    ...fontSize.sm,
  },
  customerOption: {
    padding: spacing[3],
    marginHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  customerName: {
    ...fontSize.sm,
    fontWeight: "500",
  },
  customerEmail: {
    ...fontSize.xs,
  },
  emptyText: {
    ...fontSize.sm,
    textAlign: "center",
    padding: spacing[6],
  },
});
