import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { type Call } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { SlideDown } from "@/components/ui/SlideDown";
import { VoicemailPanel } from "@/components/calls/VoicemailPanel";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { callsQueryKey, fetchStaffCalls } from "@/lib/staff-queries";
import { formatDateTime, formatPhoneNumber } from "@/lib/format";
import { useCall } from "@/lib/CallContext";
import {
  callDisplayName,
  callOutcome,
  counterpartyNumber,
  formatCallDuration,
  hasVoicemail,
  isUnknownCaller,
  voicemailTranscript,
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
  // One open panel at a time — two voicemails playing over each other is never
  // what anyone wants, and collapsing tears the other player down.
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Switching filters can hide the open row; leaving expandedId set would
  // silently reopen it on the way back.
  useEffect(() => {
    setExpandedId(null);
  }, [filter]);

  const toggleExpanded = useCallback((call: Call) => {
    setExpandedId((current) => (current === call.id ? null : call.id));
  }, []);

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
          renderItem={({ item }) => (
            <CallRow
              call={item}
              expanded={expandedId === item.id}
              onToggle={() => toggleExpanded(item)}
              onOpenCustomer={() => openCustomer(item)}
              onCallBack={() => startCall(counterpartyNumber(item), callDisplayName(item))}
              onMessage={() => {
                if (item.customer) {
                  router.push(`/(staff)/chat?customer=${item.customer.id}` as never);
                }
              }}
              onAddCustomer={() =>
                router.push(
                  `/(staff)/customers?newPhone=${encodeURIComponent(counterpartyNumber(item))}`
                )
              }
              outcomeColor={outcomeColor}
              constrained={layout.isTablet}
              tabletPortrait={layout.isTabletPortrait}
            />
          )}
        />
      )}
    </View>
  );
}

interface CallRowProps {
  call: Call;
  expanded: boolean;
  onToggle: () => void;
  onOpenCustomer: () => void;
  onCallBack: () => void;
  onMessage: () => void;
  onAddCustomer: () => void;
  outcomeColor: (outcome: CallOutcome) => string;
  constrained: boolean;
  tabletPortrait: boolean;
}

/**
 * A call log row. Rows with a voicemail expand in place instead of navigating,
 * so listening to a message never loses the reader's position in the list;
 * every other row keeps its old behaviour of opening the customer.
 */
function CallRow({
  call,
  expanded,
  onToggle,
  onOpenCustomer,
  onCallBack,
  onMessage,
  onAddCustomer,
  outcomeColor,
  constrained,
  tabletPortrait,
}: CallRowProps) {
  const { theme } = useTheme();
  const outcome = callOutcome(call);
  const missed = outcome === "missed";
  const unknown = isUnknownCaller(call);
  const duration = formatCallDuration(call.durationSeconds);
  const tint = outcomeColor(outcome);
  const voicemail = hasVoicemail(call);
  const transcript = voicemailTranscript(call);

  const chevronSpin = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevronSpin, {
      toValue: expanded ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [expanded, chevronSpin]);

  const outcomeLabel = missed
    ? voicemail
      ? "Missed · voicemail"
      : "Missed"
    : outcome === "taken"
      ? "Answered"
      : outcome === "outgoing"
        ? "Outgoing"
        : "In progress";

  return (
    <View style={[constrained && styles.tabletConstrained]}>
      <TouchableOpacity
        onPress={voicemail ? onToggle : onOpenCustomer}
        style={[
          styles.row,
          tabletPortrait && styles.rowTabletPortrait,
          { borderBottomColor: theme.surfaceBorderSubtle },
          // The panel owns the bottom edge while open, so the row shouldn't
          // draw a divider through the middle of the pair.
          expanded && styles.rowExpanded,
        ]}
        accessibilityRole="button"
        accessibilityState={voicemail ? { expanded } : undefined}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: theme.dark ? colors.slate[600] : colors.slate[400] },
          ]}
        >
          <Ionicons name={unknown ? "help" : "person"} size={20} color={colors.white} />
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
              {callDisplayName(call)}
            </Text>
            <Text style={[styles.rowTime, { color: theme.textMuted }]}>
              {formatDateTime(call.createdAt)}
            </Text>
          </View>

          <View style={styles.rowMeta}>
            <Ionicons
              name={voicemail ? "recording-outline" : OUTCOME_ICON[outcome]}
              size={12}
              color={tint}
            />
            <Text style={[styles.rowMetaText, { color: theme.textSecondary }]}>
              {outcomeLabel}
              {duration ? ` · ${duration}` : ""}
            </Text>
            {unknown ? (
              <Text style={[styles.newBadge, { color: colors.amber[600] }]}>New</Text>
            ) : null}
          </View>

          {/* A one-line transcript makes the log skimmable without opening
              anything; the panel shows the whole thing once expanded. */}
          {voicemail && !expanded && transcript.state === "ready" ? (
            <Text
              style={[styles.rowTranscript, { color: theme.textMuted }]}
              numberOfLines={1}
            >
              {transcript.text}
            </Text>
          ) : null}
        </View>

        {voicemail ? (
          <Animated.View
            style={{
              transform: [
                {
                  rotate: chevronSpin.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "180deg"],
                  }),
                },
              ],
            }}
          >
            <Ionicons name="chevron-down" size={18} color={theme.textMuted} />
          </Animated.View>
        ) : (
          <TouchableOpacity
            onPress={onCallBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.callBackButton}
            accessibilityRole="button"
            accessibilityLabel={`Call ${callDisplayName(call)} back`}
          >
            <Ionicons name="call" size={18} color={colors.emerald[600]} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <SlideDown expanded={expanded}>
        <VoicemailPanel
          call={call}
          onCallBack={onCallBack}
          onMessage={onMessage}
          onAddCustomer={unknown ? onAddCustomer : null}
        />
      </SlideDown>
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
  rowExpanded: { borderBottomWidth: 0 },
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
  rowTranscript: { ...fontSize.xs, fontStyle: "italic", marginTop: 1 },
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
