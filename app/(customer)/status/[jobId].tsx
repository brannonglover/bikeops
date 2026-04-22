import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { StageBadge, PaymentBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { formatDate, formatCurrency } from "@/lib/format";
import { computeJobSubtotal, getJobPaymentSummary } from "@/lib/job-payments";

const STAGE_DESCRIPTIONS: Record<string, string> = {
  PENDING_APPROVAL: "Your booking request has been submitted and is awaiting confirmation.",
  BOOKED_IN: "Your repair is confirmed and scheduled.",
  RECEIVED: "We've received your bike and it's in the queue.",
  WORKING_ON: "A mechanic is actively working on your bike.",
  WAITING_ON_PARTS: "We're waiting on parts to arrive for your repair.",
  BIKE_READY: "Your bike is ready for pickup!",
  COMPLETED: "Your repair is complete.",
  CANCELLED: "This booking was cancelled.",
};

export default function JobStatusScreen() {
  const { theme } = useTheme();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);

  const {
    data: job,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["job-status", jobId],
    queryFn: async () => {
      const { data } = await api.get<Job>(`/api/jobs/${jobId}`, {
        role: "customer",
      });
      return data;
    },
    enabled: !!jobId,
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          padding: spacing[4],
          gap: spacing[3],
          paddingBottom: spacing[12],
        },
        stageCard: {
          gap: spacing[3],
          alignItems: "center",
        },
        stageBanner: {
          width: "100%",
          alignItems: "center",
          paddingVertical: spacing[6],
          borderRadius: borderRadius.lg,
          gap: spacing[3],
        },
        stageIconCircle: {
          width: 56,
          height: 56,
          borderRadius: 28,
          justifyContent: "center",
          alignItems: "center",
        },
        stageDesc: {
          ...fontSize.sm,
          color: theme.textTertiary,
          textAlign: "center",
          lineHeight: 20,
          paddingHorizontal: spacing[4],
        },
        cancelReason: {
          ...fontSize.sm,
          color: colors.red[600],
          textAlign: "center",
        },
        section: {
          gap: spacing[3],
        },
        sectionTitle: {
          ...fontSize.sm,
          fontWeight: "700",
          color: theme.textHeading,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        bikeRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
        },
        bikeImage: {
          width: 56,
          height: 56,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.placeholderBg,
        },
        bikePlaceholder: {
          width: 56,
          height: 56,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.placeholderBg,
          justifyContent: "center",
          alignItems: "center",
        },
        bikeName: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
        },
        bikeComplete: {
          ...fontSize.xs,
          color: colors.emerald[600],
        },
        bikeWaiting: {
          ...fontSize.xs,
          color: colors.red[600],
        },
        infoRow: {
          flexDirection: "row",
          justifyContent: "space-between",
        },
        infoLabel: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        infoValue: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
        },
        lineItem: {
          flexDirection: "row",
          justifyContent: "space-between",
          paddingVertical: spacing[1],
        },
        lineItemName: {
          ...fontSize.sm,
          color: theme.text,
          flex: 1,
        },
        lineItemPrice: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
        totalRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
          paddingTop: spacing[3],
          marginTop: spacing[2],
        },
        totalLabel: {
          ...fontSize.base,
          fontWeight: "700",
          color: theme.text,
        },
        totalAmount: {
          ...fontSize.xl,
          fontWeight: "700",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
      }),
    [theme]
  );

  if (isLoading || !job) return <LoadingScreen message="Loading status..." />;

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
  const stageColor = STAGE_COLORS[job.stage];
  const PAYABLE_STAGES: string[] = [
    "RECEIVED",
    "WORKING_ON",
    "WAITING_ON_CUSTOMER",
    "WAITING_ON_PARTS",
    "BIKE_READY",
    "COMPLETED",
  ];
  const canPay =
    !paymentSummary.isPaidInFull && total > 0 && PAYABLE_STAGES.includes(job.stage);

  return (
    <>
      <Stack.Screen options={{ title: "Job Status" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} tintColor={theme.icon} />
        }
      >
        {/* Stage Card */}
        <Card style={styles.stageCard}>
          <View style={[styles.stageBanner, { backgroundColor: stageColor + "15" }]}>
            <View style={[styles.stageIconCircle, { backgroundColor: stageColor }]}>
              <Ionicons
                name={
                  job.stage === "BIKE_READY"
                    ? "checkmark-circle"
                    : job.stage === "CANCELLED"
                      ? "close-circle"
                      : "bicycle"
                }
                size={28}
                color={colors.white}
              />
            </View>
            <StageBadge stage={job.stage} style={{ alignSelf: "center" }} />
          </View>
          <Text style={styles.stageDesc}>
            {STAGE_DESCRIPTIONS[job.stage] ?? ""}
          </Text>
          {job.cancellationReason ? (
            <Text style={styles.cancelReason}>
              Reason: {job.cancellationReason}
            </Text>
          ) : null}
        </Card>

        {/* Bike */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            {job.jobBikes.length === 1 ? "Bike" : `Bikes (${job.jobBikes.length})`}
          </Text>
          {job.jobBikes.map((jb) => {
            const isCompleted = !!jb.completedAt;
            const isWaitingOnParts = !!jb.waitingOnPartsAt && !isCompleted;

            return (
              <View key={jb.id} style={styles.bikeRow}>
                {jb.imageUrl ? (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setViewingImageUrl(jb.imageUrl!)}
                  >
                    <Image source={{ uri: jb.imageUrl }} style={styles.bikeImage} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.bikePlaceholder}>
                    <Ionicons name="bicycle" size={24} color={theme.iconMuted} />
                  </View>
                )}
                <View>
                  <Text style={styles.bikeName}>
                    {jb.make} {jb.model}
                  </Text>
                  {isCompleted ? (
                    <Text style={styles.bikeComplete}>
                      Completed {formatDate(jb.completedAt!)}
                    </Text>
                  ) : isWaitingOnParts ? (
                    <Text style={styles.bikeWaiting}>
                      Waiting on parts
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>

        {/* Dates */}
        <Card style={styles.section}>
          {job.dropOffDate ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Drop-off</Text>
              <Text style={styles.infoValue}>{formatDate(job.dropOffDate)}</Text>
            </View>
          ) : null}
          {job.pickupDate ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Pickup</Text>
              <Text style={styles.infoValue}>{formatDate(job.pickupDate)}</Text>
            </View>
          ) : null}
        </Card>

        {/* Line Items */}
        {job.jobServices.length > 0 || job.jobProducts.length > 0 ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Line Items</Text>
            {job.jobServices.map((js) => (
              <View key={js.id} style={styles.lineItem}>
                <Text style={styles.lineItemName}>{js.service.name}</Text>
                <Text style={styles.lineItemPrice}>
                  {formatCurrency(parseFloat(js.unitPrice) * js.quantity)}
                </Text>
              </View>
            ))}
            {job.jobProducts.map((jp) => (
              <View key={jp.id} style={styles.lineItem}>
                <Text style={styles.lineItemName}>{jp.product.name}</Text>
                <Text style={styles.lineItemPrice}>
                  {formatCurrency(parseFloat(jp.unitPrice) * jp.quantity)}
                </Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
            </View>
            <PaymentBadge status={paymentSummary.paymentStatus} />
          </Card>
        ) : null}

        {canPay ? (
          <Button
            title={paymentSummary.totalPaid > 0 ? "Pay Remaining Balance" : "Pay Online"}
            onPress={() => router.push(`/(customer)/pay/${job.id}`)}
            size="lg"
          />
        ) : null}
      </ScrollView>
      <ImageViewer uri={viewingImageUrl} onClose={() => setViewingImageUrl(null)} />
    </>
  );
}
