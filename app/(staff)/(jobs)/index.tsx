import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useQuery, useMutation, useQueryClient, replaceEqualDeep } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, type Stage, DISPLAY_STAGES, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { JobCard } from "@/components/jobs/JobCard";
import { BookingDigestSheet } from "@/components/jobs/BookingDigestSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { fetchStaffJobs, jobsQueryKey } from "@/lib/staff-queries";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { customerName, formatDate, getJobBikeDisplayTitle } from "@/lib/format";
import { keepForwardBoardStage } from "@/lib/board-stage-merge";

const COLUMN_STAGES = DISPLAY_STAGES.filter(
  (stage) => stage !== "PENDING_APPROVAL"
);

const EMPTY_JOBS: Job[] = [];

// When the bike was received/checked in. Prefer receivedAt (set when the job
// enters Received), then drop-off date, then job creation time. Used to sort
// the Received column oldest-first (first come, first served).
function receivedTime(job: Job): number {
  const value = job.receivedAt ?? job.dropOffDate ?? job.createdAt;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

const WEB_STAGE_HEADER_COLORS: Record<Stage, string> = {
  PENDING_APPROVAL: colors.amber[600],
  BOOKED_IN: colors.slate[500],
  RECEIVED: colors.slate[600],
  WORKING_ON: colors.amber[500],
  WAITING_ON_CUSTOMER: "#8b5cf6",
  WAITING_ON_PARTS: colors.amber[400],
  BIKE_READY: colors.emerald[500],
  COMPLETED: "#6366f1",
  CANCELLED: colors.red[500],
};

export default function JobBoardScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const queryClient = useQueryClient();
  const navigatingRef = useRef(false);
  const useColumnBoard = layout.isTablet && layout.isLandscape;

  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
    }, [])
  );
  const [cancelledExpanded, setCancelledExpanded] = useState(false);
  const [digestHighlightIds, setDigestHighlightIds] = useState<string[]>([]);
  const digestHighlightSet = useMemo(
    () => new Set(digestHighlightIds),
    [digestHighlightIds]
  );

  const handleDigestHighlightIdsChange = useCallback((ids: string[]) => {
    setDigestHighlightIds((prev) => {
      if (
        prev.length === ids.length &&
        prev.every((id, i) => id === ids[i])
      ) {
        return prev;
      }
      return ids;
    });
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: jobsQueryKey,
    queryFn: fetchStaffJobs,
    refetchInterval: 15_000,
    structuralSharing: (prev: unknown, next: unknown) => {
      if (!Array.isArray(prev) || !Array.isArray(next)) {
        return replaceEqualDeep(prev, next);
      }
      const prevJobs = prev as Job[];
      const nextJobs = next as Job[];
      const prevById = new Map(prevJobs.map((j) => [j.id, j]));
      return nextJobs.map((j) => {
        const live = prevById.get(j.id);
        return live ? keepForwardBoardStage(live, j) : j;
      });
    },
  });
  // Stable empty fallback — `data = []` allocates a new array every render
  // while loading and infinite-loops BookingDigestSheet highlights.
  const jobs = data ?? EMPTY_JOBS;

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
    mutationFn: async ({
      jobId,
      stage,
      notifyCustomer,
      completedAt,
    }: {
      jobId: string;
      stage: Stage;
      notifyCustomer?: boolean;
      completedAt?: string | null;
    }) => {
      const { data } = await api.patch<Job>(`/api/jobs/${jobId}`, {
        stage,
        ...(typeof notifyCustomer === "boolean" ? { notifyCustomer } : {}),
        ...(typeof completedAt !== "undefined" ? { completedAt } : {}),
      });
      return data;
    },
    onMutate: async ({ jobId, stage, notifyCustomer, completedAt }) => {
      await queryClient.cancelQueries({ queryKey: ["jobs"] });
      await queryClient.cancelQueries({ queryKey: ["job", jobId] });

      const prevJobs = queryClient.getQueryData<Job[]>(["jobs"]);
      const prevJob = queryClient.getQueryData<Job>(["job", jobId]);

      /** Mirror API / web withOptimisticStageChange so Waiting→Working doesn't snap back. */
      const apply = (j: Job): Job => {
        const bikes = j.jobBikes ?? [];
        const incomplete = bikes.filter((b) => !b.completedAt);
        let next: Job = {
          ...j,
          stage,
          ...(typeof notifyCustomer === "boolean" ? { notifyCustomer } : {}),
          ...(typeof completedAt !== "undefined" ? { completedAt } : {}),
        };

        if (stage === "WAITING_ON_PARTS") {
          const wid = j.workingOnJobBikeId;
          if (j.stage !== "WAITING_ON_PARTS" && wid) {
            const now = new Date().toISOString();
            next = {
              ...next,
              workingOnJobBikeId: null,
              jobBikes: bikes.map((b) =>
                b.id === wid && !b.completedAt
                  ? { ...b, waitingOnPartsAt: now }
                  : b
              ),
            };
          }
        } else {
          next = {
            ...next,
            jobBikes: bikes.map((b) =>
              b.completedAt ? b : { ...b, waitingOnPartsAt: null }
            ),
          };
          if (stage === "WORKING_ON" && incomplete.length === 1) {
            next = { ...next, workingOnJobBikeId: incomplete[0].id };
          } else if (stage !== "WORKING_ON") {
            next = { ...next, workingOnJobBikeId: null };
          }
        }

        if (stage === "BIKE_READY" || stage === "COMPLETED") {
          next = { ...next, workingOnJobBikeId: null };
        }

        return next;
      };

      if (prevJobs && Array.isArray(prevJobs)) {
        queryClient.setQueryData(
          ["jobs"],
          prevJobs.map((j) => (j.id === jobId ? apply(j) : j))
        );
      }
      if (prevJob && prevJob.id === jobId) {
        queryClient.setQueryData(["job", jobId], apply(prevJob));
      }

      return { prevJobs, prevJob };
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevJobs) queryClient.setQueryData(["jobs"], ctx.prevJobs);
      if (ctx.prevJob) queryClient.setQueryData(["job", vars.jobId], ctx.prevJob);
    },
    onSuccess: (updated) => {
      const prevJobs = queryClient.getQueryData<Job[]>(["jobs"]);
      if (prevJobs && Array.isArray(prevJobs)) {
        queryClient.setQueryData(
          ["jobs"],
          prevJobs.map((j) => (j.id === updated.id ? updated : j))
        );
      }
      queryClient.setQueryData(["job", updated.id], updated);
    },
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
      DISPLAY_STAGES.reduce((acc, stage) => {
        const stageJobs = jobs.filter((j) => j.stage === stage);
        // Order the Received column first-come, first-served (oldest intake first)
        // so staff can service bikes in the order they arrived.
        if (stage === "RECEIVED") {
          stageJobs.sort(
            (a, b) => receivedTime(a) - receivedTime(b)
          );
        }
        return { ...acc, [stage]: stageJobs };
      }, {} as Record<Stage, Job[]>),
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
  const pendingApprovals = jobsByStage.PENDING_APPROVAL ?? [];

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

  const openJob = useCallback(
    (job: Job) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      queryClient.setQueryData(["job", job.id], job);
      router.push(`/(staff)/(jobs)/${job.id}`);
    },
    [queryClient, router]
  );

  const renderJobCard = useCallback(
    (item: Job, wrapperStyle?: StyleProp<ViewStyle>) => (
      <View style={[styles.cardWrapper, wrapperStyle]}>
        <View
          style={digestHighlightSet.has(item.id) ? styles.digestHighlight : null}
        >
          <JobCard
            job={item}
            onPress={() => openJob(item)}
            onAccept={
              item.stage === "PENDING_APPROVAL" ? () => handleAccept(item.id) : undefined
            }
            onReject={
              item.stage === "PENDING_APPROVAL" ? () => handleReject(item) : undefined
            }
          />
        </View>
      </View>
    ),
    [openJob, handleAccept, handleReject, digestHighlightSet]
  );

  const renderItem = useCallback(
    ({ item }: { item: Job }) => renderJobCard(item),
    [renderJobCard]
  );

  const showInitialLoad = isLoading && jobs.length === 0;

  const pendingApprovalPanel =
    useColumnBoard && pendingApprovals.length > 0 ? (
      <View
        style={[
          styles.pendingPanel,
          {
            backgroundColor: theme.surface,
            borderColor: theme.surfaceBorder,
          },
        ]}
      >
        <View
          style={[
            styles.pendingPanelHeader,
            { borderBottomColor: theme.surfaceBorderSubtle },
          ]}
        >
          <View style={styles.pendingPanelTitleRow}>
            <View style={styles.pendingCountBadge}>
              <Text style={styles.pendingCountText}>
                {pendingApprovals.length}
              </Text>
            </View>
            <Text style={[styles.pendingTitle, { color: theme.textHeading }]}>
              Pending approval
            </Text>
            <Text
              style={[styles.pendingSubtitle, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              Booking{pendingApprovals.length === 1 ? "" : "s"} waiting on a yes/no
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={isManualRefresh}
            style={[
              styles.pendingRefreshButton,
              { backgroundColor: theme.subtleBg },
              isManualRefresh && styles.disabledButton,
            ]}
            accessibilityLabel="Refresh pending approvals"
          >
            <Ionicons name="refresh" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.pendingList}
          contentContainerStyle={styles.pendingListContent}
          showsVerticalScrollIndicator={false}
        >
          {pendingApprovals.map((job) => (
            <View
              key={job.id}
              style={[
                styles.pendingRow,
                { borderBottomColor: theme.surfaceBorderSubtle },
              ]}
            >
              <TouchableOpacity
                onPress={() => openJob(job)}
                style={styles.pendingJobButton}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.pendingJobCustomer, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {job.customer ? customerName(job.customer) : "Walk-in customer"}
                </Text>
                <Text
                  style={[styles.pendingJobBike, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {getJobBikeDisplayTitle(job)}
                </Text>
              </TouchableOpacity>
              {job.dropOffDate ? (
                <Text
                  style={[
                    styles.pendingDate,
                    {
                      color: theme.textTertiary,
                      backgroundColor: theme.subtleBg,
                    },
                  ]}
                >
                  {formatDate(job.dropOffDate)}
                </Text>
              ) : (
                <View style={styles.pendingDateSpacer} />
              )}
              <View style={styles.pendingActions}>
                <TouchableOpacity
                  onPress={() => handleAccept(job.id)}
                  style={styles.pendingAcceptButton}
                  accessibilityLabel="Accept booking"
                >
                  <Ionicons name="checkmark" size={16} color={colors.emerald[700]} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleReject(job)}
                  style={styles.pendingRejectButton}
                  accessibilityLabel="Reject booking"
                >
                  <Ionicons name="close" size={16} color={colors.red[700]} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    ) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {pendingApprovalPanel}
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
        {useColumnBoard && cancelledJobs.length > 0 ? (
          <TouchableOpacity
            onPress={() => setCancelledExpanded((e) => !e)}
            style={[
              styles.archiveButton,
              {
                borderColor: theme.inputBorder,
                backgroundColor: cancelledExpanded
                  ? theme.subtleBg
                  : theme.surface,
              },
            ]}
          >
            <Text style={[styles.archiveText, { color: colors.red[600] }]}>
              Cancelled ({cancelledJobs.length})
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => router.push("/(staff)/(jobs)/new")}
          style={styles.newJobButton}
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newJobText}>New Job</Text>
        </TouchableOpacity>
      </View>

      {showInitialLoad ? (
        <View style={styles.initialLoad}>
          <BikeLoader label="Loading jobs…" />
        </View>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No jobs yet"
          message="Create your first job to get started."
        />
      ) : useColumnBoard ? (
        <View style={styles.landscapeBoard}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.boardScroller}
            contentContainerStyle={styles.boardContent}
          >
            {[
              ...COLUMN_STAGES,
              ...(cancelledExpanded && cancelledJobs.length > 0
                ? ["CANCELLED" as Stage]
                : []),
            ].map((stage) => {
              const stageJobs =
                stage === "CANCELLED" ? cancelledJobs : jobsByStage[stage] ?? [];
              const stageColor = WEB_STAGE_HEADER_COLORS[stage];

              return (
                <View
                  key={stage}
                  style={[
                    styles.boardColumn,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.surfaceBorder,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.boardColumnHeader,
                      {
                        backgroundColor: stageColor,
                        borderBottomColor: stageColor,
                      },
                    ]}
                  >
                    <View style={styles.boardColumnTitleRow}>
                      <Text
                        style={[
                          styles.boardColumnTitle,
                          { color: colors.white },
                        ]}
                        numberOfLines={1}
                      >
                        {STAGE_LABELS[stage]}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.boardCountBadge,
                        { backgroundColor: "rgba(255, 255, 255, 0.24)" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.boardCountText,
                          { color: colors.white },
                        ]}
                      >
                        {stageJobs.length}
                      </Text>
                    </View>
                  </View>

                  <ScrollView
                    style={styles.boardColumnScroll}
                    contentContainerStyle={styles.boardColumnContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {stageJobs.length > 0 ? (
                      stageJobs.map((job) =>
                        renderJobCard(job, styles.boardCardWrapper)
                      )
                    ) : (
                      <View
                        style={[
                          styles.boardEmpty,
                          { borderColor: theme.surfaceBorderSubtle },
                        ]}
                      >
                        <Text
                          style={[
                            styles.boardEmptyText,
                            { color: theme.textMuted },
                          ]}
                        >
                          No jobs
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View
              style={[
                styles.sectionHeader,
                layout.isTablet && styles.tabletConstrained,
                layout.isTabletPortrait && styles.sectionHeaderTabletPortrait,
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
              <Text
                style={[
                  styles.sectionTitle,
                  layout.isTabletPortrait && styles.sectionTitleTabletPortrait,
                  { color: theme.textTertiary },
                ]}
              >
                {STAGE_LABELS[section.title as Stage]}
              </Text>
              <View style={[styles.countBadge, { backgroundColor: theme.subtleBg }]}>
                <Text
                  style={[
                    styles.countText,
                    layout.isTabletPortrait && styles.countTextTabletPortrait,
                    { color: theme.textTertiary },
                  ]}
                >
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
          style={layout.isTablet && styles.tabletList}
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

      <BookingDigestSheet
        jobs={jobs}
        isLoading={isLoading}
        onOpenJob={openJob}
        onHighlightIdsChange={handleDigestHighlightIdsChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  digestHighlight: {
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.amber[400],
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
  tabletList: {
    width: "100%",
  },
  tabletConstrained: {
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
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
  landscapeBoard: {
    flex: 1,
  },
  pendingPanel: {
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    overflow: "hidden",
  },
  pendingPanelHeader: {
    minHeight: 44,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  pendingPanelTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minWidth: 0,
  },
  pendingCountBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    backgroundColor: colors.amber[100],
    alignItems: "center",
    justifyContent: "center",
  },
  pendingCountText: {
    ...fontSize.xs,
    fontWeight: "700",
    color: colors.amber[800],
    fontVariant: ["tabular-nums"],
  },
  pendingTitle: {
    ...fontSize.sm,
    fontWeight: "700",
  },
  pendingSubtitle: {
    ...fontSize.xs,
    flex: 1,
  },
  pendingRefreshButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingList: {
    maxHeight: 180,
  },
  pendingListContent: {
    paddingHorizontal: spacing[3],
  },
  pendingRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderBottomWidth: 1,
  },
  pendingJobButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing[2],
  },
  pendingJobCustomer: {
    ...fontSize.sm,
    fontWeight: "700",
  },
  pendingJobBike: {
    ...fontSize.xs,
  },
  pendingDate: {
    ...fontSize.xs,
    fontWeight: "700",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.md,
  },
  pendingDateSpacer: {
    width: 1,
  },
  pendingActions: {
    flexDirection: "row",
    gap: spacing[1.5],
  },
  pendingAcceptButton: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.emerald[50],
    alignItems: "center",
    justifyContent: "center",
  },
  pendingRejectButton: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.red[50],
    alignItems: "center",
    justifyContent: "center",
  },
  boardContent: {
    gap: spacing[3],
    padding: spacing[4],
    paddingBottom: spacing[6],
  },
  boardScroller: {
    flex: 1,
  },
  boardColumn: {
    width: 292,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    overflow: "hidden",
  },
  boardColumnHeader: {
    minHeight: 52,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing[2],
  },
  boardColumnTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flex: 1,
  },
  boardColumnTitle: {
    ...fontSize.sm,
    fontWeight: "700",
    flex: 1,
  },
  boardCountBadge: {
    borderRadius: borderRadius.full,
    minWidth: 28,
    minHeight: 24,
    paddingHorizontal: spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  boardCountText: {
    ...fontSize.xs,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  boardColumnScroll: {
    flex: 1,
  },
  boardColumnContent: {
    paddingVertical: spacing[2],
    minHeight: 180,
  },
  boardCardWrapper: {
    paddingHorizontal: spacing[2],
    maxWidth: undefined,
  },
  boardEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing[2],
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  boardEmptyText: {
    ...fontSize.xs,
    fontWeight: "600",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
  },
  sectionHeaderTabletPortrait: {
    paddingVertical: spacing[3],
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
  sectionTitleTabletPortrait: {
    ...fontSize.base,
    fontWeight: "700",
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
  countTextTabletPortrait: {
    ...fontSize.sm,
    fontWeight: "700",
  },
  cardWrapper: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
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
  initialLoad: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing[12],
  },
});
