import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, type Stage, DISPLAY_STAGES, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { JobCard } from "@/components/jobs/JobCard";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function JobBoardScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cancelledExpanded, setCancelledExpanded] = useState(false);

  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data } = await api.get<Job[]>("/api/jobs");
      return data;
    },
    refetchInterval: 15_000,
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

  const patchStage = useMutation({
    mutationFn: async ({ jobId, stage }: { jobId: string; stage: Stage }) => {
      const { data } = await api.patch<Job>(`/api/jobs/${jobId}`, { stage });
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      await api.post("/api/jobs/archive-completed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const handleAccept = useCallback(
    (jobId: string) => {
      patchStage.mutate({ jobId, stage: "BOOKED_IN" });
    },
    [patchStage]
  );

  const handleReject = useCallback(
    (job: Job) => {
      Alert.prompt(
        "Reject Booking",
        "Reason for rejection (required):",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reject",
            style: "destructive",
            onPress: (reason?: string) => {
              const trimmed = reason?.trim();
              if (!trimmed) {
                Alert.alert("Reason required", "Please enter a reason for rejecting this booking.");
                return;
              }
              api.patch(`/api/jobs/${job.id}`, {
                stage: "CANCELLED",
                cancellationReason: trimmed,
              }).then(() => queryClient.invalidateQueries({ queryKey: ["jobs"] }));
            },
          },
        ],
        "plain-text"
      );
    },
    [queryClient]
  );

  const handleStageChange = useCallback(
    (jobId: string, stage: Stage) => {
      patchStage.mutate({ jobId, stage });
    },
    [patchStage]
  );

  const jobsByStage = useMemo(
    () =>
      DISPLAY_STAGES.reduce(
        (acc, stage) => ({ ...acc, [stage]: jobs.filter((j) => j.stage === stage) }),
        {} as Record<Stage, Job[]>
      ),
    [jobs]
  );

  const cancelledJobs = useMemo(
    () => jobs.filter((j) => j.stage === "CANCELLED"),
    [jobs]
  );

  const completedCount = useMemo(
    () => jobs.filter((j) => j.stage === "COMPLETED").length,
    [jobs]
  );

  const sections = useMemo(() => {
    const result = DISPLAY_STAGES.filter(
      (stage) => (jobsByStage[stage]?.length ?? 0) > 0
    ).map((stage) => ({
      title: stage,
      data: jobsByStage[stage] ?? [],
    }));
    if (cancelledExpanded && cancelledJobs.length > 0) {
      result.push({ title: "CANCELLED" as Stage, data: cancelledJobs });
    }
    return result;
  }, [jobsByStage, cancelledJobs, cancelledExpanded]);

  const renderItem = useCallback(
    ({ item }: { item: Job }) => (
      <View style={styles.cardWrapper}>
        <JobCard
          job={item}
          onPress={() => router.push(`/(staff)/(jobs)/${item.id}`)}
          onAccept={
            item.stage === "PENDING_APPROVAL" ? () => handleAccept(item.id) : undefined
          }
          onReject={
            item.stage === "PENDING_APPROVAL" ? () => handleReject(item) : undefined
          }
        />
      </View>
    ),
    [router, handleAccept, handleReject]
  );

  if (isLoading) return <LoadingScreen message="Loading jobs..." />;

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
        <TouchableOpacity
          onPress={() => archiveMutation.mutate()}
          disabled={archiveMutation.isPending || completedCount === 0}
          style={[
            styles.archiveButton,
            {
              borderColor: theme.inputBorder,
              backgroundColor: theme.surface,
            },
            (archiveMutation.isPending || completedCount === 0) && styles.disabledButton,
          ]}
        >
          <Text
            style={[
              styles.archiveText,
              { color: completedCount === 0 ? theme.textMuted : theme.textTertiary },
            ]}
          >
            {completedCount > 0 ? `Archive (${completedCount})` : "Archive"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/(staff)/(jobs)/new")}
          style={styles.newJobButton}
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newJobText}>New Job</Text>
        </TouchableOpacity>
      </View>

      {jobs.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No jobs yet"
          message="Create your first job to get started."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View
              style={[
                styles.sectionHeader,
                {
                  backgroundColor: theme.background,
                  borderBottomColor: theme.surfaceBorder,
                },
              ]}
            >
              <View
                style={[
                  styles.stageDot,
                  { backgroundColor: STAGE_COLORS[section.title as Stage] },
                ]}
              />
              <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
                {STAGE_LABELS[section.title as Stage]}
              </Text>
              <View style={[styles.countBadge, { backgroundColor: theme.subtleBg }]}>
                <Text style={[styles.countText, { color: theme.textTertiary }]}>
                  {section.data.length}
                </Text>
              </View>
            </View>
          )}
          stickySectionHeadersEnabled
          refreshControl={
            <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
          }
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            cancelledJobs.length > 0 ? (
              <TouchableOpacity
                onPress={() => setCancelledExpanded((e) => !e)}
                style={[
                  styles.cancelledToggle,
                  { borderTopColor: theme.surfaceBorder },
                ]}
              >
                <Text style={styles.cancelledLabel}>
                  Cancelled ({cancelledJobs.length})
                </Text>
                <Ionicons
                  name={cancelledExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.red[600]}
                />
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
    borderBottomWidth: 1,
  },
  archiveButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  archiveText: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.5,
  },
  newJobButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.amber[500],
    borderRadius: borderRadius.xl,
  },
  newJobText: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.white,
  },
  listContent: {
    paddingBottom: spacing[12],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  countBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
  },
  countText: {
    ...fontSize.xs,
    fontWeight: "600",
  },
  cardWrapper: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
  },
  cancelledToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginTop: spacing[2],
    borderTopWidth: 1,
  },
  cancelledLabel: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.red[600],
  },
});
