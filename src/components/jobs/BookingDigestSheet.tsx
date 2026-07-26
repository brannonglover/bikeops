import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";
import { type Job } from "@/lib/types";
import { customerName, formatDate, getJobBikeDisplayTitle } from "@/lib/format";
import {
  consumePendingBookingDigest,
  subscribeBookingDigest,
  type BookingDigest,
} from "@/lib/pending-booking-digest";

function isDropOffOnLocalDay(iso: string | null, dayOffset: number): boolean {
  if (!iso) return false;
  const dropOff = new Date(iso);
  if (Number.isNaN(dropOff.getTime())) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + dayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return dropOff >= start && dropOff < end;
}

function resolveDigestJobs(
  jobs: Job[],
  digest: BookingDigest
): { today: Job[]; tomorrow: Job[] } {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const hasIds =
    digest.todayJobIds.length > 0 || digest.tomorrowJobIds.length > 0;

  if (hasIds) {
    return {
      today: digest.todayJobIds
        .map((id) => byId.get(id))
        .filter((job): job is Job => !!job),
      tomorrow: digest.tomorrowJobIds
        .map((id) => byId.get(id))
        .filter((job): job is Job => !!job),
    };
  }

  const bookedIn = jobs.filter((job) => job.stage === "BOOKED_IN");
  return {
    today: bookedIn.filter((job) => isDropOffOnLocalDay(job.dropOffDate, 0)),
    tomorrow: bookedIn.filter((job) => isDropOffOnLocalDay(job.dropOffDate, 1)),
  };
}

function deliveryLabel(job: Job): string {
  return job.deliveryType === "COLLECTION_SERVICE" ? "Collection" : "Drop-off";
}

const EMPTY_HIGHLIGHT_IDS: string[] = [];
const EMPTY_JOBS: Job[] = [];

export function BookingDigestSheet({
  jobs,
  isLoading,
  onOpenJob,
  onHighlightIdsChange,
}: {
  jobs: Job[];
  isLoading: boolean;
  onOpenJob: (job: Job) => void;
  onHighlightIdsChange?: (ids: string[]) => void;
}) {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [digest, setDigest] = useState<BookingDigest | null>(null);

  const present = useCallback((next: BookingDigest) => {
    consumePendingBookingDigest();
    setDigest(next);
    setVisible(true);
  }, []);

  useEffect(() => {
    const existing = consumePendingBookingDigest();
    if (existing) present(existing);
    return subscribeBookingDigest(present);
  }, [present]);

  const { today, tomorrow } = useMemo(
    () =>
      digest
        ? resolveDigestJobs(jobs, digest)
        : { today: EMPTY_JOBS, tomorrow: EMPTY_JOBS },
    [digest, jobs]
  );

  const highlightIds = useMemo(
    () => [...today, ...tomorrow].map((job) => job.id),
    [today, tomorrow]
  );

  useEffect(() => {
    const next = visible ? highlightIds : EMPTY_HIGHLIGHT_IDS;
    onHighlightIdsChange?.(next);
  }, [visible, highlightIds, onHighlightIdsChange]);

  const close = useCallback(() => {
    setVisible(false);
    setDigest(null);
  }, []);

  const handleOpen = useCallback(
    (job: Job) => {
      close();
      onOpenJob(job);
    },
    [close, onOpenJob]
  );

  const waitingForJobs =
    visible &&
    !!digest &&
    isLoading &&
    jobs.length === 0 &&
    (digest.todayJobIds.length > 0 || digest.tomorrowJobIds.length > 0);

  const empty =
    visible &&
    !waitingForJobs &&
    today.length === 0 &&
    tomorrow.length === 0;

  return (
    <BottomSheetModal
      visible={visible}
      title="Upcoming drop-offs"
      onClose={close}
    >
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {waitingForJobs ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.amber[600]} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              Loading bookings…
            </Text>
          </View>
        ) : empty ? (
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            No booked-in bikes for today or tomorrow.
          </Text>
        ) : (
          <>
            {today.length > 0 ? (
              <DigestSection
                title={`Today (${today.length})`}
                jobs={today}
                onOpenJob={handleOpen}
              />
            ) : null}
            {tomorrow.length > 0 ? (
              <DigestSection
                title={`Tomorrow (${tomorrow.length})`}
                jobs={tomorrow}
                onOpenJob={handleOpen}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </BottomSheetModal>
  );
}

function DigestSection({
  title,
  jobs,
  onOpenJob,
}: {
  title: string;
  jobs: Job[];
  onOpenJob: (job: Job) => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textTertiary }]}>
        {title}
      </Text>
      {jobs.map((job) => (
        <TouchableOpacity
          key={job.id}
          onPress={() => onOpenJob(job)}
          activeOpacity={0.7}
          style={[
            styles.row,
            {
              backgroundColor: theme.surface,
              borderColor: colors.amber[300],
            },
          ]}
        >
          <View style={styles.rowBody}>
            <Text
              style={[styles.customer, { color: theme.textHeading }]}
              numberOfLines={1}
            >
              {job.customer ? customerName(job.customer) : "Walk-in customer"}
            </Text>
            <Text
              style={[styles.bike, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {getJobBikeDisplayTitle(job)}
            </Text>
            <Text style={[styles.meta, { color: theme.textTertiary }]}>
              {deliveryLabel(job)}
              {job.dropOffDate ? ` · ${formatDate(job.dropOffDate)}` : ""}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 420,
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[4],
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[4],
  },
  emptyText: {
    ...fontSize.sm,
    paddingVertical: spacing[4],
  },
  section: {
    gap: spacing[2],
  },
  sectionTitle: {
    ...fontSize.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  row: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  rowBody: {
    gap: 2,
  },
  customer: {
    ...fontSize.sm,
    fontWeight: "700",
  },
  bike: {
    ...fontSize.sm,
  },
  meta: {
    ...fontSize.xs,
    marginTop: 2,
  },
});
