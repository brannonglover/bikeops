import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Image,
  TouchableOpacity,
  Linking,
  Animated,
} from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useStripe } from "@stripe/stripe-react-native";
import { ApiError, api, resolveCustomerUrl } from "@/lib/api";
import { type Job, type Stage } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme, type AppTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import {
  formatDate,
  formatCurrency,
  getJobBikeDisplayTitle,
} from "@/lib/format";
import { computeJobSubtotal, getJobPaymentSummary } from "@/lib/job-payments";
import {
  alertPaymentResult,
  presentJobPaymentSheet,
} from "@/lib/customer-payment";

const JOB_STATUS_POLL_MS = 15_000;

const TRACKER_STEPS: {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "RECEIVED", label: "Received", icon: "checkmark" },
  { key: "WORKING_ON", label: "Working on", icon: "build" },
  { key: "BIKE_READY", label: "Ready", icon: "bicycle" },
  { key: "COMPLETED", label: "Picked up", icon: "home" },
];

function getOrderNumber(jobId: string): string {
  return jobId.replace(/-/g, "").slice(-4).toUpperCase();
}

/** Maps job stage → tracker step index (0–3). -1 = not yet received. */
function getTrackerIndex(stage: Stage): number {
  switch (stage) {
    case "PENDING_APPROVAL":
    case "BOOKED_IN":
      return -1;
    case "RECEIVED":
      return 0;
    case "WORKING_ON":
    case "WAITING_ON_CUSTOMER":
    case "WAITING_ON_PARTS":
      return 1;
    case "BIKE_READY":
      return 2;
    case "COMPLETED":
      return 3;
    case "CANCELLED":
      return -1;
    default:
      return -1;
  }
}

function paymentBadgeConfig(
  status: string,
  theme: AppTheme
): { label: string; color: string; bg: string } {
  switch (status) {
    case "PAID":
      return {
        label: "Paid",
        color: colors.emerald[theme.dark ? 500 : 700],
        bg: theme.dark ? colors.emerald[800] + "55" : colors.emerald[50],
      };
    case "PENDING":
      return {
        label: "Partially paid",
        color: colors.amber[theme.dark ? 400 : 700],
        bg: theme.dark ? colors.amber[800] + "55" : colors.amber[50],
      };
    case "REFUNDED":
      return {
        label: "Refunded",
        color: colors.red[theme.dark ? 500 : 700],
        bg: theme.dark ? colors.red[800] + "55" : colors.red[50],
      };
    default:
      return {
        label: "Unpaid",
        color: colors.orange[theme.dark ? 500 : 600],
        bg: theme.dark ? colors.orange[500] + "22" : colors.orange[50],
      };
  }
}

const trackerDotStyles = StyleSheet.create({
  wrap: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  pulseRing: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
});

function PulsingTrackerDot({
  backgroundColor,
  icon,
  iconColor,
  pulse,
}: {
  backgroundColor: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  pulse: boolean;
}) {
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (!pulse) {
      ringScale.setValue(1);
      ringOpacity.setValue(0);
      return;
    }

    ringScale.setValue(1);
    ringOpacity.setValue(0.45);

    const animation = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1.85,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0,
            duration: 1400,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.45,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, ringOpacity, ringScale]);

  return (
    <View style={trackerDotStyles.wrap}>
      {pulse ? (
        <Animated.View
          pointerEvents="none"
          style={[
            trackerDotStyles.pulseRing,
            {
              backgroundColor,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
      ) : null}
      <View style={[trackerDotStyles.dot, { backgroundColor }]}>
        <Ionicons name={icon} size={14} color={iconColor} />
      </View>
    </View>
  );
}

function StatusTracker({
  stage,
  theme,
  styles,
}: {
  stage: Stage;
  theme: AppTheme;
  styles: ReturnType<typeof createStyles>;
}) {
  const currentIndex = getTrackerIndex(stage);
  const accent = colors.blue[500];
  const isCancelled = stage === "CANCELLED";

  return (
    <Card style={styles.trackerCard}>
      <View style={styles.trackerRow}>
        {TRACKER_STEPS.map((step, index) => {
          const allDone = !isCancelled && stage === "COMPLETED";
          const isComplete = allDone || (!isCancelled && currentIndex > index);
          const isCurrent = !isCancelled && !allDone && currentIndex === index;
          const isActive = isComplete || isCurrent;
          const isLast = index === TRACKER_STEPS.length - 1;
          const shouldPulse = isCurrent && step.key === "WORKING_ON";

          return (
            <View key={step.key} style={styles.trackerStep}>
              <View style={styles.trackerStepTop}>
                <PulsingTrackerDot
                  backgroundColor={isActive ? accent : theme.subtleBg}
                  icon={isComplete ? "checkmark" : step.icon}
                  iconColor={isActive ? colors.white : theme.iconMuted}
                  pulse={shouldPulse}
                />
                {!isLast ? (
                  <View
                    style={[
                      styles.trackerLine,
                      {
                        backgroundColor: isComplete
                          ? accent
                          : theme.surfaceBorder,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <Text
                style={[
                  styles.trackerLabel,
                  {
                    color:
                      isCurrent || (allDone && isLast)
                        ? theme.text
                        : theme.textSecondary,
                    fontWeight:
                      isCurrent || (allDone && isLast) ? "700" : "500",
                  },
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
      {isCancelled ? (
        <Text style={styles.cancelledNote}>This booking was cancelled.</Text>
      ) : null}
    </Card>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      padding: spacing[4],
      gap: spacing[3],
      paddingBottom: spacing[12],
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing[3],
      paddingHorizontal: spacing[1],
      marginBottom: spacing[1],
    },
    headerText: {
      flex: 1,
      gap: spacing[1],
    },
    orderNumber: {
      ...fontSize.sm,
      color: theme.textSecondary,
    },
    bikeTitle: {
      ...fontSize["2xl"],
      fontWeight: "700",
      color: theme.text,
    },
    paymentBadge: {
      paddingHorizontal: spacing[2.5],
      paddingVertical: spacing[1.5],
      borderRadius: borderRadius.lg,
      marginTop: spacing[0.5],
    },
    paymentBadgeText: {
      ...fontSize.sm,
      fontWeight: "600",
    },
    trackerCard: {
      paddingVertical: spacing[5],
      paddingHorizontal: spacing[3],
    },
    trackerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    trackerStep: {
      flex: 1,
      alignItems: "center",
      gap: spacing[2],
    },
    trackerStepTop: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    trackerLine: {
      position: "absolute",
      left: "50%",
      right: "-50%",
      height: 2,
      top: 15,
    },
    trackerLabel: {
      ...fontSize.xs,
      textAlign: "center",
    },
    cancelledNote: {
      ...fontSize.sm,
      color: colors.red[theme.dark ? 500 : 600],
      textAlign: "center",
      marginTop: spacing[3],
    },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
    },
    contactAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.placeholderBg,
    },
    contactAvatarPlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.placeholderBg,
      justifyContent: "center",
      alignItems: "center",
    },
    contactName: {
      ...fontSize.base,
      fontWeight: "700",
      color: theme.text,
    },
    contactActions: {
      flexDirection: "row",
      gap: spacing[2],
    },
    contactActionBtn: {
      width: 40,
      height: 40,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.surfaceBorder,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.surface,
    },
    sectionLabel: {
      ...fontSize.sm,
      color: theme.textSecondary,
      marginBottom: spacing[1],
    },
    lineItem: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing[3],
      paddingVertical: spacing[1],
    },
    lineItemLeft: {
      flex: 1,
      gap: 2,
    },
    lineItemName: {
      ...fontSize.base,
      fontWeight: "700",
      color: theme.text,
    },
    lineItemMeta: {
      ...fontSize.sm,
      color: theme.textSecondary,
    },
    lineItemPrice: {
      ...fontSize.base,
      fontWeight: "700",
      color: theme.text,
      fontVariant: ["tabular-nums"],
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 1,
      borderTopColor: theme.surfaceBorder,
      paddingTop: spacing[3],
      marginTop: spacing[3],
    },
    totalLabel: {
      ...fontSize.base,
      fontWeight: "700",
      color: theme.text,
    },
    totalAmount: {
      ...fontSize.base,
      fontWeight: "700",
      color: theme.text,
      fontVariant: ["tabular-nums"],
    },
    cancelReason: {
      ...fontSize.sm,
      color: colors.red[theme.dark ? 500 : 600],
    },
    errorWrap: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing[6],
      gap: spacing[3],
      backgroundColor: theme.background,
    },
    errorText: {
      ...fontSize.sm,
      color: theme.textSecondary,
      textAlign: "center",
    },
    payButton: {
      borderRadius: borderRadius.full,
      marginTop: spacing[1],
    },
  });
}

export default function JobStatusScreen() {
  const { theme } = useTheme();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const {
    data: job,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["job-status", jobId],
    queryFn: async () => {
      // Customer session auth — /api/jobs/:id requires staff or ?access= token.
      const { data } = await api.get<Job[]>("/api/customer/jobs", {
        role: "customer",
      });
      const match = data.find((j) => j.id === jobId);
      if (!match) throw new ApiError("Job not found", 404);
      return match;
    },
    enabled: !!jobId,
    refetchInterval: JOB_STATUS_POLL_MS,
  });

  const { data: branding } = useQuery({
    queryKey: ["shop-branding"],
    queryFn: async () => {
      const { data } = await api.get<{ shopPhone?: string | null }>(
        "/api/settings/branding",
        { role: "customer" }
      );
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

  const styles = useMemo(() => createStyles(theme), [theme]);
  const [paying, setPaying] = useState(false);

  const handlePay = useCallback(async () => {
    if (!jobId || paying) return;
    setPaying(true);
    try {
      const result = await presentJobPaymentSheet(jobId, {
        initPaymentSheet,
        presentPaymentSheet,
      });
      alertPaymentResult(result, () => {
        void refetch();
      });
      if (result.status === "success") {
        void refetch();
      }
    } finally {
      setPaying(false);
    }
  }, [jobId, paying, initPaymentSheet, presentPaymentSheet, refetch]);

  if (isLoading) return <LoadingScreen message="Loading status..." />;

  if (isError || !job) {
    const message =
      error instanceof ApiError
        ? error.message
        : "Couldn't load this job. Please try again.";
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorText}>{message}</Text>
        <Button title="Try Again" onPress={() => void refetch()} />
      </View>
    );
  }

  const total = computeJobSubtotal({
    jobServices: job.jobServices,
    jobProducts: job.jobProducts,
  });
  const paymentSummary = getJobPaymentSummary({
    currentStatus: job.paymentStatus,
    subtotal: total,
    totalPaid:
      typeof job.totalPaid === "number" && Number.isFinite(job.totalPaid)
        ? job.totalPaid
        : 0,
  });
  const PAYABLE_STAGES: string[] = [
    "RECEIVED",
    "WORKING_ON",
    "WAITING_ON_CUSTOMER",
    "WAITING_ON_PARTS",
    "BIKE_READY",
    "COMPLETED",
  ];
  const canPay =
    !paymentSummary.isPaidInFull &&
    total > 0 &&
    PAYABLE_STAGES.includes(job.stage);

  const bikeTitle = getJobBikeDisplayTitle(job);
  const badge = paymentBadgeConfig(paymentSummary.paymentStatus, theme);
  const mechanic = job.mechanic ?? null;
  const mechanicImageUrl = mechanic?.imageUrl
    ? resolveCustomerUrl(mechanic.imageUrl)
    : null;
  const shopPhone = branding?.shopPhone?.trim() || null;

  const deliveryLabel =
    job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off";
  const deliveryDate = job.dropOffDate ? formatDate(job.dropOffDate) : null;
  const lineItemMeta =
    deliveryDate != null ? `${deliveryLabel} · ${deliveryDate}` : null;

  const hasLineItems =
    job.jobServices.length > 0 || job.jobProducts.length > 0;

  return (
    <>
      <Stack.Screen options={{ title: "Job Status" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isManualRefresh}
            onRefresh={handleRefresh}
            tintColor={theme.icon}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.orderNumber}>
              Order #{getOrderNumber(job.id)}
            </Text>
            <Text style={styles.bikeTitle}>{bikeTitle}</Text>
          </View>
          <View style={[styles.paymentBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.paymentBadgeText, { color: badge.color }]}>
              {badge.label}
            </Text>
          </View>
        </View>

        <StatusTracker stage={job.stage} theme={theme} styles={styles} />

        {job.cancellationReason ? (
          <Card>
            <Text style={styles.cancelReason}>
              Reason: {job.cancellationReason}
            </Text>
          </Card>
        ) : null}

        <Card>
          <View style={styles.contactRow}>
            {mechanicImageUrl ? (
              <Image
                source={{ uri: mechanicImageUrl }}
                style={styles.contactAvatar}
              />
            ) : (
              <View style={styles.contactAvatarPlaceholder}>
                <Ionicons name="person" size={22} color={theme.iconMuted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>
                {mechanic?.fullName ?? "Your shop"}
              </Text>
            </View>
            <View style={styles.contactActions}>
              {shopPhone ? (
                <TouchableOpacity
                  style={styles.contactActionBtn}
                  onPress={() => void Linking.openURL(`tel:${shopPhone}`)}
                  accessibilityLabel="Call shop"
                >
                  <Ionicons name="call-outline" size={18} color={theme.icon} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.contactActionBtn}
                onPress={() => router.push("/(customer)/chat")}
                accessibilityLabel="Message shop"
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={18}
                  color={theme.icon}
                />
              </TouchableOpacity>
            </View>
          </View>
        </Card>

        {hasLineItems ? (
          <Card>
            <Text style={styles.sectionLabel}>Line items</Text>
            {job.jobServices.map((js, index) => (
              <View key={js.id} style={styles.lineItem}>
                <View style={styles.lineItemLeft}>
                  <Text style={styles.lineItemName}>
                    {js.service?.name ?? js.customServiceName ?? "Service"}
                  </Text>
                  {index === 0 && lineItemMeta ? (
                    <Text style={styles.lineItemMeta}>{lineItemMeta}</Text>
                  ) : null}
                </View>
                <Text style={styles.lineItemPrice}>
                  {formatCurrency(parseFloat(js.unitPrice) * js.quantity)}
                </Text>
              </View>
            ))}
            {job.jobProducts.map((jp, index) => (
              <View key={jp.id} style={styles.lineItem}>
                <View style={styles.lineItemLeft}>
                  <Text style={styles.lineItemName}>{jp.product.name}</Text>
                  {job.jobServices.length === 0 &&
                  index === 0 &&
                  lineItemMeta ? (
                    <Text style={styles.lineItemMeta}>{lineItemMeta}</Text>
                  ) : null}
                </View>
                <Text style={styles.lineItemPrice}>
                  {formatCurrency(parseFloat(jp.unitPrice) * jp.quantity)}
                </Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
            </View>
          </Card>
        ) : null}

        {canPay ? (
          <Button
            title={
              paying
                ? "Processing..."
                : `Pay ${formatCurrency(paymentSummary.remaining)}`
            }
            onPress={() => void handlePay()}
            loading={paying}
            size="lg"
            style={styles.payButton}
          />
        ) : null}
      </ScrollView>
    </>
  );
}
