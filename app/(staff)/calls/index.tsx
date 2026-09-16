import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { type Call } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { callsQueryKey, fetchStaffCalls } from "@/lib/staff-queries";
import { formatDateTime, formatPhoneNumber } from "@/lib/format";
import { useCall } from "@/lib/CallContext";
import {
  callDisplayName,
  callOutcome,
  counterpartyNumber,
  formatCallDuration,
  isUnknownCaller,
  type CallOutcome,
} from "@/lib/calls";

type Filter = "all" | "missed";

const OUTCOME_ICON: Record<CallOutcome, keyof typeof Ionicons.glyphMap> = {
  taken: "arrow-down",
  missed: "close",
  outgoing: "arrow-up",
  "in-progress": "ellipse",
};

export default function CallsScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const { startCall, registration } = useCall();
  const [filter, setFilter] = useState<Filter>("all");
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const {
    data: calls = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: callsQueryKey,
    queryFn: fetchStaffCalls,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const visible =
    filter === "missed" ? calls.filter((c) => callOutcome(c) === "missed") : calls;

  const outcomeColor = (outcome: CallOutcome): string => {
    if (outcome === "missed") return colors.red[600];
    if (outcome === "outgoing") return theme.textMuted;
    return colors.emerald[600];
  };

  const openCustomer = (call: Call) => {
    if (call.customer) {
      router.push(`/(staff)/customers/${call.customer.id}`);
      return;
    }
    // No customer record yet — offer the two things worth doing with a stranger.
    const number = counterpartyNumber(call);
    Alert.alert(formatPhoneNumber(number), "This caller isn't a customer yet.", [
      { text: "Cancel", style: "cancel" },
      { text: "Call back", onPress: () => startCall(number) },
      {
        text: "Add as customer",
        onPress: () =>
          router.push(`/(staff)/customers?newPhone=${encodeURIComponent(number)}`),
      },
    ]);
  };

  const showInitialLoad = isLoading && calls.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.toolbar,
          { backgroundColor: theme.surface, borderBottomColor: theme.surfaceBorder },
        ]}
      >
        {(["all", "missed"] as const).map((key) => {
          const active = filter === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setFilter(key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? colors.slate[700] : "transparent",
                  borderColor: active ? colors.slate[700] : theme.surfaceBorder,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: active ? colors.white : theme.textSecondary },
                ]}
              >
                {key === "all" ? "All" : "Missed"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {registration.status === "failed" ? (
        // Inbound calls silently fail when this device isn't registered with
        // Twilio, and nothing else in the UI would ever show it.
        <View style={[styles.warningBanner, { backgroundColor: colors.amber[600] }]}>
          <Ionicons name="warning-outline" size={16} color={colors.white} />
          <Text style={[styles.warningText, { color: colors.white }]} numberOfLines={2}>
            Not receiving calls on this device{registration.error ? ` — ${registration.error}` : ""}
          </Text>
        </View>
      ) : null}

      {showInitialLoad ? (
        <View style={styles.initialLoad}>
          <BikeLoader label="Loading calls…" />
        </View>
      ) : isError ? (
        // Distinct from the empty state on purpose: /api/calls 404s when voice
        // is disabled for the shop, and silently rendering "No calls yet" for
        // that made a config problem look like an absence of calls.
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load calls"
          message={
            error instanceof Error && error.message
              ? error.message
              : "Retrying automatically."
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="call-outline"
          title={filter === "missed" ? "No missed calls" : "No calls yet"}
          message={
            filter === "missed"
              ? "Missed calls and voicemails will show up here."
              : "Calls to and from the shop will show up here."
          }
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const outcome = callOutcome(item);
            const missed = outcome === "missed";
            const unknown = isUnknownCaller(item);
            const duration = formatCallDuration(item.durationSeconds);
            const tint = outcomeColor(outcome);

            return (
              <TouchableOpacity
                onPress={() => openCustomer(item)}
                style={[
                  styles.row,
                  layout.isTablet && styles.tabletConstrained,
                  layout.isTabletPortrait && styles.rowTabletPortrait,
                  { borderBottomColor: theme.surfaceBorderSubtle },
                ]}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: theme.dark ? colors.slate[600] : colors.slate[400] },
                  ]}
                >
                  <Ionicons
                    name={unknown ? "help" : "person"}
                    size={20}
                    color={colors.white}
                  />
                </View>

                <View style={styles.rowContent}>
                  <View style={styles.rowHeader}>
                    <Text
                      style={[
                        styles.rowName,
                        { color: missed ? colors.red[600] : theme.text },
                        missed && styles.rowNameBold,
                      ]}
                      numberOfLines={1}
                    >
                      {callDisplayName(item)}
                    </Text>
                    <Text style={[styles.rowTime, { color: theme.textMuted }]}>
                      {formatDateTime(item.createdAt)}
                    </Text>
                  </View>

                  <View style={styles.rowMeta}>
                    <Ionicons name={OUTCOME_ICON[outcome]} size={12} color={tint} />
                    <Text style={[styles.rowMetaText, { color: theme.textSecondary }]}>
                      {outcome === "taken"
                        ? "Answered"
                        : outcome === "missed"
                          ? item.recordingUrl
                            ? "Missed · voicemail"
                            : "Missed"
                          : outcome === "outgoing"
                            ? "Outgoing"
                            : "In progress"}
                      {duration ? ` · ${duration}` : ""}
                    </Text>
                    {unknown ? (
                      <Text style={[styles.newBadge, { color: colors.amber[600] }]}>
                        New
                      </Text>
                    ) : null}
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => startCall(counterpartyNumber(item), callDisplayName(item))}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.callBackButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${callDisplayName(item)} back`}
                >
                  <Ionicons name="call" size={18} color={colors.emerald[600]} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  initialLoad: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing[12],
  },
  toolbar: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  filterChip: {
    paddingVertical: spacing[1.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  filterText: {
    ...fontSize.sm,
    fontWeight: "500",
  },
  listContent: { paddingBottom: spacing[12] },
  tabletConstrained: {
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing[3],
    gap: spacing[3],
    borderBottomWidth: 1,
  },
  rowTabletPortrait: { padding: spacing[4] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  rowContent: { flex: 1, gap: 2 },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowName: { ...fontSize.sm, flex: 1 },
  rowNameBold: { fontWeight: "600" },
  rowTime: { ...fontSize.xs, marginLeft: spacing[2] },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  rowMetaText: { ...fontSize.xs },
  newBadge: {
    ...fontSize.xs,
    fontWeight: "600",
    marginLeft: spacing[1],
  },
  callBackButton: { padding: spacing[2] },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  warningText: {
    ...fontSize.xs,
    fontWeight: "500",
    flex: 1,
  },
});
