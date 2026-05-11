import { View, Text, TouchableOpacity, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { StageBadge, PaymentBadge } from "@/components/ui/Badge";
import { type Job, STAGE_LABELS, type Stage } from "@/lib/types";
import { customerName, getJobBikeDisplayTitle, formatDate } from "@/lib/format";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface JobCardProps {
  job: Job;
  onPress: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  showStageSelect?: boolean;
  onStageChange?: (jobId: string, stage: Stage) => void;
}

export function JobCard({
  job,
  onPress,
  onAccept,
  onReject,
}: JobCardProps) {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const showPortraitThumb = layout.isTabletPortrait;
  const jobBikes = job.jobBikes ?? [];
  const jobServices = job.jobServices ?? [];
  const bikeImageUrl = jobBikes.find((bike) => bike.imageUrl)?.imageUrl;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.card,
        showPortraitThumb && styles.cardTabletPortrait,
        { backgroundColor: theme.surface, borderColor: theme.surfaceBorder },
      ]}
    >
      <View style={showPortraitThumb && styles.tabletRow}>
        {showPortraitThumb ? (
          bikeImageUrl ? (
            <Image
              source={{ uri: bikeImageUrl }}
              style={[styles.bikeThumb, { backgroundColor: theme.placeholderBg }]}
            />
          ) : (
            <View style={[styles.bikeThumbPlaceholder, { backgroundColor: theme.placeholderBg }]}>
              <Ionicons name="bicycle" size={28} color={theme.iconMuted} />
            </View>
          )
        ) : null}

        <View style={styles.cardBody}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons
                name="bicycle"
                size={showPortraitThumb ? 18 : 16}
                color={theme.textMuted}
              />
              <Text
                style={[
                  styles.bikeLabel,
                  showPortraitThumb && styles.bikeLabelTabletPortrait,
                  { color: theme.text },
                ]}
                numberOfLines={1}
              >
                {getJobBikeDisplayTitle(job)}
              </Text>
            </View>
            <PaymentBadge status={job.paymentStatus} />
          </View>

          {job.customer ? (
            <Text
              style={[
                styles.customerName,
                showPortraitThumb && styles.customerNameTabletPortrait,
                { color: theme.textTertiary },
              ]}
              numberOfLines={1}
            >
              {customerName(job.customer)}
            </Text>
          ) : null}

          {job.stage !== "COMPLETED" && job.stage !== "CANCELLED" && (() => {
            const hasWaitingBike = jobBikes.some(
              (b) => b.waitingOnPartsAt && !b.completedAt && b.id !== job.workingOnJobBikeId
            );
            if (!hasWaitingBike) return null;
            return (
              <Text
                style={[
                  styles.waitingLabel,
                  showPortraitThumb && styles.metaTabletPortrait,
                ]}
              >
                <Ionicons name="time-outline" size={showPortraitThumb ? 13 : 11} /> Waiting on parts
              </Text>
            );
          })()}

          {jobBikes.length > 1 ? (
            <Text
              style={[
                styles.meta,
                showPortraitThumb && styles.metaTabletPortrait,
                { color: theme.textSecondary },
              ]}
            >
              {jobBikes.length} bikes
            </Text>
          ) : null}

          {jobServices.length > 0 ? (
            <Text
              style={[
                styles.meta,
                showPortraitThumb && styles.metaTabletPortrait,
                { color: theme.textSecondary },
              ]}
              numberOfLines={1}
            >
              {jobServices
                .filter((s) => s?.service)
                .map((s) => s.service.name)
                .join(", ")}
            </Text>
          ) : null}

          <View style={styles.footer}>
            {job.dropOffDate ? (
              <Text
                style={[
                  styles.date,
                  showPortraitThumb && styles.metaTabletPortrait,
                  { color: theme.textMuted },
                ]}
              >
                {job.deliveryType === "COLLECTION_SERVICE" ? "Collection pickup" : "Drop-off"}:{" "}
                {formatDate(job.dropOffDate)}
              </Text>
            ) : null}
            {job.pickupDate ? (
              <Text
                style={[
                  styles.date,
                  showPortraitThumb && styles.metaTabletPortrait,
                  { color: theme.textMuted },
                ]}
              >
                {job.deliveryType === "COLLECTION_SERVICE" ? "Collection return" : "Pickup"}:{" "}
                {formatDate(job.pickupDate)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      {job.stage === "PENDING_APPROVAL" && (onAccept || onReject) ? (
        <View style={[styles.actions, { borderTopColor: theme.surfaceBorderSubtle }]}>
          {onAccept ? (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                onAccept();
              }}
              style={styles.acceptButton}
            >
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          ) : null}
          {onReject ? (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                onReject();
              }}
              style={styles.rejectButton}
            >
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: spacing[1.5],
  },
  cardTabletPortrait: {
    padding: spacing[4],
  },
  tabletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
  },
  bikeThumb: {
    width: 84,
    height: 84,
    borderRadius: borderRadius.xl,
  },
  bikeThumbPlaceholder: {
    width: 84,
    height: 84,
    borderRadius: borderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: spacing[1.5],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
    flex: 1,
  },
  bikeLabel: {
    ...fontSize.sm,
    fontWeight: "600",
    flex: 1,
  },
  bikeLabelTabletPortrait: {
    ...fontSize.lg,
  },
  customerName: {
    ...fontSize.xs,
  },
  customerNameTabletPortrait: {
    ...fontSize.base,
  },
  meta: {
    ...fontSize.xs,
  },
  metaTabletPortrait: {
    ...fontSize.sm,
  },
  waitingLabel: {
    ...fontSize.xs,
    fontWeight: "600",
    color: colors.red[700],
  },
  footer: {
    flexDirection: "row",
    gap: spacing[3],
  },
  date: {
    ...fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[1],
    borderTopWidth: 1,
    paddingTop: spacing[2],
  },
  acceptButton: {
    flex: 1,
    paddingVertical: spacing[1.5],
    backgroundColor: colors.emerald[50],
    borderRadius: borderRadius.lg,
    alignItems: "center",
  },
  acceptText: {
    ...fontSize.xs,
    fontWeight: "600",
    color: colors.emerald[700],
  },
  rejectButton: {
    flex: 1,
    paddingVertical: spacing[1.5],
    backgroundColor: colors.red[50],
    borderRadius: borderRadius.lg,
    alignItems: "center",
  },
  rejectText: {
    ...fontSize.xs,
    fontWeight: "600",
    color: colors.red[700],
  },
});
