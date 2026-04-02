import { View, Text, ScrollView, RefreshControl, StyleSheet, Image } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Card } from "@/components/ui/Card";
import { StageBadge, PaymentBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatDate, formatCurrency, jobBikeLabel, jobTotal } from "@/lib/format";

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
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();

  const {
    data: job,
    isLoading,
    refetch,
    isRefetching,
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

  if (isLoading || !job) return <LoadingScreen message="Loading status..." />;

  const total = jobTotal(job.jobServices, job.jobProducts);
  const stageColor = STAGE_COLORS[job.stage];
  const canPay =
    job.paymentStatus !== "PAID" && total > 0 && job.stage !== "CANCELLED";

  return (
    <>
      <Stack.Screen options={{ title: "Job Status" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
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
          {job.jobBikes.map((jb) => (
            <View key={jb.id} style={styles.bikeRow}>
              {jb.imageUrl ? (
                <Image source={{ uri: jb.imageUrl }} style={styles.bikeImage} />
              ) : (
                <View style={styles.bikePlaceholder}>
                  <Ionicons name="bicycle" size={24} color={colors.slate[300]} />
                </View>
              )}
              <View>
                <Text style={styles.bikeName}>
                  {jb.make} {jb.model}
                </Text>
                {jb.completedAt ? (
                  <Text style={styles.bikeComplete}>
                    Completed {formatDate(jb.completedAt)}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
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
            <PaymentBadge status={job.paymentStatus} />
          </Card>
        ) : null}

        {canPay ? (
          <Button
            title="Pay Online"
            onPress={() => router.push(`/(customer)/pay/${job.id}`)}
            size="lg"
          />
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
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
    color: colors.slate[600],
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
    color: colors.slate[800],
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
    backgroundColor: colors.slate[100],
  },
  bikePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[100],
    justifyContent: "center",
    alignItems: "center",
  },
  bikeName: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
  },
  bikeComplete: {
    ...fontSize.xs,
    color: colors.emerald[600],
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: {
    ...fontSize.sm,
    color: colors.slate[500],
  },
  infoValue: {
    ...fontSize.sm,
    fontWeight: "500",
    color: colors.slate[900],
  },
  lineItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing[1],
  },
  lineItemName: {
    ...fontSize.sm,
    color: colors.slate[900],
    flex: 1,
  },
  lineItemPrice: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.slate[200],
    paddingTop: spacing[3],
    marginTop: spacing[2],
  },
  totalLabel: {
    ...fontSize.base,
    fontWeight: "700",
    color: colors.slate[900],
  },
  totalAmount: {
    ...fontSize.xl,
    fontWeight: "700",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
});
