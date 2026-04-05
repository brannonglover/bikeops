import { useState, useCallback } from "react";
import { View, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type Job } from "@/lib/types";
import { spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { JobCard } from "@/components/jobs/JobCard";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ArchiveScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const {
    data: jobs = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["jobs", "archived"],
    queryFn: async () => {
      const { data } = await api.get<Job[]>("/api/jobs?archived=true");
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

  if (isLoading) return <LoadingScreen message="Loading archive..." />;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {jobs.length === 0 ? (
        <EmptyState
          icon="archive-outline"
          title="No archived jobs"
          message="Completed jobs you archive will appear here."
        />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.cardWrapper}>
              <JobCard
                job={item}
                onPress={() => router.push(`/(staff)/(jobs)/${item.id}`)}
              />
            </View>
          )}
          refreshControl={
            <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: spacing[4],
    gap: spacing[2],
    paddingBottom: spacing[12],
  },
  cardWrapper: {
    marginBottom: spacing[2],
  },
});
