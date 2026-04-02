import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { StageBadge, PaymentBadge } from "@/components/ui/Badge";
import { type Job, STAGE_LABELS, type Stage } from "@/lib/types";
import { customerName, jobBikeLabel, formatDate } from "@/lib/format";

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
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="bicycle" size={16} color={colors.slate[400]} />
          <Text style={styles.bikeLabel} numberOfLines={1}>
            {jobBikeLabel(job)}
          </Text>
        </View>
        <PaymentBadge status={job.paymentStatus} />
      </View>

      {job.customer ? (
        <Text style={styles.customerName} numberOfLines={1}>
          {customerName(job.customer)}
        </Text>
      ) : null}

      {job.jobBikes.length > 1 ? (
        <Text style={styles.meta}>
          {job.jobBikes.length} bikes
        </Text>
      ) : null}

      {job.jobServices.length > 0 ? (
        <Text style={styles.meta} numberOfLines={1}>
          {job.jobServices.map((s) => s.service.name).join(", ")}
        </Text>
      ) : null}

      <View style={styles.footer}>
        {job.dropOffDate ? (
          <Text style={styles.date}>
            Drop-off: {formatDate(job.dropOffDate)}
          </Text>
        ) : null}
        {job.pickupDate ? (
          <Text style={styles.date}>
            Pickup: {formatDate(job.pickupDate)}
          </Text>
        ) : null}
      </View>

      {job.stage === "PENDING_APPROVAL" && (onAccept || onReject) ? (
        <View style={styles.actions}>
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
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.slate[200],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
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
    color: colors.slate[900],
    flex: 1,
  },
  customerName: {
    ...fontSize.xs,
    color: colors.slate[600],
  },
  meta: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  footer: {
    flexDirection: "row",
    gap: spacing[3],
  },
  date: {
    ...fontSize.xs,
    color: colors.slate[400],
  },
  actions: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[1],
    borderTopWidth: 1,
    borderTopColor: colors.slate[100],
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
