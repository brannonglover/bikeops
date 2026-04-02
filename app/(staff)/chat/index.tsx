import { useState, useEffect, useCallback } from "react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Conversation, type Customer } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { customerName, formatDateTime } from "@/lib/format";

export default function ChatListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ customer?: string }>();
  const queryClient = useQueryClient();
  const [showNewModal, setShowNewModal] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  const {
    data: conversations = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data } = await api.get<Conversation[]>("/api/conversations");
      return data;
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (params.customer && conversations.length > 0) {
      const existing = conversations.find(
        (c) => c.customerId === params.customer && !c.jobId
      );
      if (existing) {
        router.replace(`/(staff)/chat/${existing.id}`);
      }
    }
  }, [params.customer, conversations, router]);

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
    const existing = conversations.find(
      (c) => c.customerId === customerId && !c.jobId
    );
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

  if (isLoading) return <LoadingScreen message="Loading chats..." />;

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
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={openNewModal} style={styles.newButton}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newButtonText}>New conversation</Text>
        </TouchableOpacity>
      </View>

      {conversations.length === 0 ? (
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
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={({ item }) => {
            const lastMsg = getLastMessage(item);
            const unread = hasUnread(item);
            return (
              <TouchableOpacity
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
                style={[styles.row, unread && styles.rowUnread]}
              >
                <View style={styles.avatar}>
                  <Ionicons
                    name="person"
                    size={20}
                    color={colors.white}
                  />
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowHeader}>
                    <Text
                      style={[styles.rowName, unread && styles.rowNameBold]}
                      numberOfLines={1}
                    >
                      {customerName(item.customer)}
                      {item.job
                        ? ` · ${item.job.bikeMake} ${item.job.bikeModel}`
                        : ""}
                    </Text>
                    {lastMsg ? (
                      <Text style={styles.rowTime}>
                        {formatDateTime(lastMsg.createdAt)}
                      </Text>
                    ) : null}
                  </View>
                  {lastMsg ? (
                    <Text
                      style={[styles.rowPreview, unread && styles.rowPreviewBold]}
                      numberOfLines={1}
                    >
                      {lastMsg.sender === "STAFF" ? "You: " : ""}
                      {lastMsg.body || "(image)"}
                    </Text>
                  ) : (
                    <Text style={styles.rowPreview}>No messages yet</Text>
                  )}
                </View>
                {unread ? <View style={styles.unreadDot} /> : null}
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* New conversation modal */}
      <Modal
        visible={showNewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNewModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Start conversation</Text>
            <TouchableOpacity onPress={() => setShowNewModal(false)}>
              <Ionicons name="close" size={24} color={colors.slate[500]} />
            </TouchableOpacity>
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, email, or phone..."
            style={styles.searchInput}
            placeholderTextColor={colors.slate[400]}
          />
          <FlatList
            data={filteredCustomers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => selectCustomer(item.id)}
                style={styles.customerOption}
              >
                <Text style={styles.customerName}>
                  {customerName(item)}
                </Text>
                {item.email ? (
                  <Text style={styles.customerEmail}>{item.email}</Text>
                ) : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No customers found</Text>
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
    backgroundColor: colors.white,
  },
  toolbar: {
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[200],
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
    borderBottomColor: colors.slate[100],
  },
  rowUnread: {
    backgroundColor: colors.emerald[50] + "40",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.slate[400],
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
    color: colors.slate[900],
    flex: 1,
  },
  rowNameBold: {
    fontWeight: "600",
  },
  rowTime: {
    ...fontSize.xs,
    color: colors.slate[400],
    marginLeft: spacing[2],
  },
  rowPreview: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  rowPreviewBold: {
    fontWeight: "500",
    color: colors.slate[700],
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.emerald[500],
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.white,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[200],
  },
  modalTitle: {
    ...fontSize.lg,
    fontWeight: "600",
    color: colors.slate[900],
  },
  searchInput: {
    margin: spacing[4],
    borderWidth: 1,
    borderColor: colors.slate[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    ...fontSize.sm,
    color: colors.slate[900],
  },
  customerOption: {
    padding: spacing[3],
    marginHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[100],
  },
  customerName: {
    ...fontSize.sm,
    fontWeight: "500",
    color: colors.slate[900],
  },
  customerEmail: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  emptyText: {
    ...fontSize.sm,
    color: colors.slate[500],
    textAlign: "center",
    padding: spacing[6],
  },
});
