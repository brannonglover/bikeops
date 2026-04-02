import { View, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type Job } from "@/lib/types";
import { colors, spacing } from "@/lib/theme";
import { JobCard } from "@/components/jobs/JobCard";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ArchiveScreen() {
  const router = useRouter();

  const {
    data: jobs = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["jobs", "archived"],
    queryFn: async () => {
      const { data } = await api.get<Job[]>("/api/jobs?archived=true");
      return data;
    },
  });

  if (isLoading) return <LoadingScreen message="Loading archive..." />;

  return (
    <View style={styles.container}>
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
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
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
    backgroundColor: colors.slate[50],
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
