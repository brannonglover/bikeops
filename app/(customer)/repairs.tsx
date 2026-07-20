import { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job, STAGE_COLORS } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { StageBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatDate, getJobBikeDisplayTitle } from "@/lib/format";

const ACTIVE_STAGES = new Set<string>([
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_PARTS",
  "BIKE_READY",
]);

const CUSTOMER_JOBS_POLL_MS = 60_000;

export default function RepairsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const {
    data: jobs,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["customer-jobs"],
    queryFn: async () => {
      const { data } = await api.get<Job[]>("/api/customer/jobs", {
        role: "customer",
      });
      return data;
    },
    refetchInterval: CUSTOMER_JOBS_POLL_MS,
  });

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const { active, past } = useMemo(() => {
    const all = jobs ?? [];
    return {
      active: all.filter((j) => ACTIVE_STAGES.has(j.stage)),
      past: all.filter((j) => !ACTIVE_STAGES.has(j.stage)),
    };
  }, [jobs]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          padding: spacing[4],
          gap: spacing[4],
          paddingBottom: spacing[12],
        },
        sectionTitle: {
          ...fontSize.sm,
          fontWeight: "700",
          color: theme.textHeading,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: spacing[1],
        },
        sectionGroup: {
          gap: spacing[2],
        },
        jobRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
        },
        jobIconCircle: {
          width: 40,
          height: 40,
          borderRadius: 20,
          justifyContent: "center",
          alignItems: "center",
        },
        jobInfo: {
          flex: 1,
          gap: 2,
        },
        jobTitle: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
        },
        jobMeta: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        emptySection: {
          ...fontSize.sm,
          color: theme.textMuted,
          textAlign: "center",
          paddingVertical: spacing[6],
        },
      }),
    [theme]
  );

  if (isLoading) return <LoadingScreen message="Loading repairs..." />;

  if (!jobs || jobs.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: "My Repairs" }} />
        <EmptyState
          icon="bicycle-outline"
          title="No repairs yet"
          message="Book your first repair and it will show up here."
        />
      </>
    );
  }

  const renderJobCard = (job: Job) => {
    const stageColor = STAGE_COLORS[job.stage] ?? colors.slate[500];
    const bikeTitle = getJobBikeDisplayTitle(job);

    return (
      <TouchableOpacity
        key={job.id}
        activeOpacity={0.7}
        onPress={() => router.push(`/(customer)/status/${job.id}`)}
      >
        <Card style={styles.jobRow}>
          <View
            style={[
              styles.jobIconCircle,
              { backgroundColor: stageColor + "15" },
            ]}
          >
            <Ionicons name="bicycle" size={20} color={stageColor} />
          </View>
          <View style={styles.jobInfo}>
            <Text style={styles.jobTitle} numberOfLines={1}>
              {bikeTitle}
            </Text>
            <Text style={styles.jobMeta}>
              {formatDate(job.createdAt)}
            </Text>
          </View>
          <StageBadge stage={job.stage} />
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.textMuted}
          />
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: "My Repairs" }} />
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
        {active.length > 0 ? (
          <View style={styles.sectionGroup}>
            <Text style={styles.sectionTitle}>Active</Text>
            {active.map(renderJobCard)}
          </View>
        ) : null}

        {past.length > 0 ? (
          <View style={styles.sectionGroup}>
            <Text style={styles.sectionTitle}>Past</Text>
            {past.map(renderJobCard)}
          </View>
        ) : null}

        {active.length === 0 && past.length === 0 ? (
          <Text style={styles.emptySection}>No repairs found.</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
