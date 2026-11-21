import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type WaitlistEntry } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { customerName, formatDateTime, formatPhoneNumber } from "@/lib/format";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

const WAITLIST_KEY = ["waitlist"] as const;

function bikeSummary(entry: WaitlistEntry): string {
  if (!entry.bikes.length) return "No bikes specified";
  if (entry.bikes.length === 1) {
    const b = entry.bikes[0];
    return [b.make, b.model].filter(Boolean).join(" ") || "1 bike";
  }
  return `${entry.bikes.length} bikes`;
}

export default function WaitlistScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const queryClient = useQueryClient();

  const {
    data: entries = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: WAITLIST_KEY,
    queryFn: async () => {
      const { data } = await api.get<WaitlistEntry[]>("/api/waitlist");
      return data;
    },
  });

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const removeOptimistically = (id: string): WaitlistEntry[] => {
    const snapshot =
      queryClient.getQueryData<WaitlistEntry[]>(WAITLIST_KEY) ?? [];
    queryClient.setQueryData<WaitlistEntry[]>(
      WAITLIST_KEY,
      snapshot.filter((e) => e.id !== id)
    );
    return snapshot;
  };

  const promote = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ jobId: string }>(
        `/api/waitlist/${encodeURIComponent(id)}/promote`
      );
      return data;
    },
    onMutate: (id: string) => ({ snapshot: removeOptimistically(id) }),
    onError: (err, _id, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(WAITLIST_KEY, context.snapshot);
      }
      Alert.alert(
        "Couldn't promote",
        err instanceof Error ? err.message : "Please try again."
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/api/waitlist/${encodeURIComponent(id)}/cancel`);
    },
    onMutate: (id: string) => ({ snapshot: removeOptimistically(id) }),
    onError: (err, _id, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(WAITLIST_KEY, context.snapshot);
      }
      Alert.alert(
        "Couldn't dismiss",
        err instanceof Error ? err.message : "Please try again."
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });

  const confirmPromote = (entry: WaitlistEntry) => {
    Alert.alert(
      "Promote to job?",
      `Create a job for ${customerName(entry)} and remove them from the waitlist.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Promote", onPress: () => promote.mutate(entry.id) },
      ]
    );
  };

  const confirmDismiss = (entry: WaitlistEntry) => {
    Alert.alert(
      "Dismiss request?",
      `Remove ${customerName(entry)} from the waitlist. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss",
          style: "destructive",
          onPress: () => dismiss.mutate(entry.id),
        },
      ]
    );
  };

  if (isLoading && !entries.length)
    return <LoadingScreen message="Loading waitlist..." />;

  const bikeCount = entries.reduce((sum, e) => sum + e.bikes.length, 0);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {entries.length === 0 ? (
        <FlatList
          data={[]}
          renderItem={null}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefresh}
              onRefresh={handleRefresh}
            />
          }
          contentContainerStyle={styles.emptyContainer}
          ListEmptyComponent={
            <EmptyState
              icon="hourglass-outline"
              title="No waitlist requests"
              message="New booking requests that can't be scheduled right away will show up here."
            />
          }
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefresh}
              onRefresh={handleRefresh}
            />
          }
          ListHeaderComponent={
            <View
              style={[
                styles.summary,
                layout.isTablet && styles.tabletConstrained,
              ]}
            >
              <Text style={[styles.summaryText, { color: theme.textSecondary }]}>
                {entries.length} {entries.length === 1 ? "request" : "requests"}
                {" · "}
                {bikeCount} {bikeCount === 1 ? "bike" : "bikes"} waiting
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isBusy =
              (promote.isPending && promote.variables === item.id) ||
              (dismiss.isPending && dismiss.variables === item.id);
            return (
              <View
                style={[
                  styles.card,
                  layout.isTablet && styles.tabletConstrained,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.surfaceBorder,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text style={[styles.name, { color: theme.text }]}>
                    {customerName(item)}
                  </Text>
                  <Text style={[styles.timestamp, { color: theme.textMuted }]}>
                    {formatDateTime(item.createdAt)}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Ionicons
                    name={
                      item.deliveryType === "COLLECTION_SERVICE"
                        ? "car-outline"
                        : "storefront-outline"
                    }
                    size={14}
                    color={theme.iconMuted}
                  />
                  <Text style={[styles.metaText, { color: theme.textSecondary }]}>
                    {item.deliveryType === "COLLECTION_SERVICE"
                      ? "Collection"
                      : "Drop-off"}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Ionicons name="bicycle" size={14} color={theme.iconMuted} />
                  <Text style={[styles.metaText, { color: theme.textSecondary }]}>
                    {bikeSummary(item)}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Ionicons name="build-outline" size={14} color={theme.iconMuted} />
                  <Text
                    style={[styles.metaText, { color: theme.textSecondary }]}
                    numberOfLines={2}
                  >
                    {item.serviceNames.length
                      ? item.serviceNames.join(", ")
                      : "No services specified"}
                  </Text>
                </View>

                {item.customerNotes ? (
                  <View
                    style={[styles.notes, { backgroundColor: theme.subtleBg }]}
                  >
                    <Text
                      style={[styles.notesText, { color: theme.textSecondary }]}
                    >
                      {item.customerNotes}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.contactRow}>
                  {item.email ? (
                    <View style={styles.contactItem}>
                      <Ionicons name="mail-outline" size={13} color={theme.iconMuted} />
                      <Text
                        style={[styles.contactText, { color: theme.textTertiary }]}
                        numberOfLines={1}
                      >
                        {item.email}
                      </Text>
                    </View>
                  ) : null}
                  {item.phone ? (
                    <View style={styles.contactItem}>
                      <Ionicons name="call-outline" size={13} color={theme.iconMuted} />
                      <Text
                        style={[styles.contactText, { color: theme.textTertiary }]}
                        numberOfLines={1}
                      >
                        {formatPhoneNumber(item.phone)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  <Button
                    title="Dismiss"
                    variant="secondary"
                    size="sm"
                    onPress={() => confirmDismiss(item)}
                    disabled={isBusy}
                    style={styles.actionButton}
                  />
                  <Button
                    title="Promote"
                    size="sm"
                    onPress={() => confirmPromote(item)}
                    loading={promote.isPending && promote.variables === item.id}
                    disabled={isBusy}
                    style={styles.actionButton}
                  />
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: spacing[3],
    gap: spacing[3],
    paddingBottom: spacing[12],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  tabletConstrained: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  summary: {
    paddingHorizontal: spacing[1],
    paddingBottom: spacing[1],
  },
  summaryText: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  card: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[4],
    gap: spacing[2],
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  name: {
    ...fontSize.base,
    fontWeight: "700",
    flex: 1,
  },
  timestamp: {
    ...fontSize.xs,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  metaText: {
    ...fontSize.sm,
    flex: 1,
  },
  notes: {
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginTop: spacing[1],
  },
  notesText: {
    ...fontSize.sm,
    fontStyle: "italic",
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
    marginTop: spacing[1],
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    flexShrink: 1,
  },
  contactText: {
    ...fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[2],
  },
  actionButton: {
    flex: 1,
  },
});
