import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type EmailTemplate } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function EmailTemplatesScreen() {
  const {
    data: templates = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data } = await api.get<EmailTemplate[]>("/api/email-templates");
      return data;
    },
  });

  if (isLoading) return <LoadingScreen message="Loading templates..." />;

  if (templates.length === 0) {
    return (
      <EmptyState
        icon="mail-outline"
        title="No email templates"
        message="Templates are created via the web app."
      />
    );
  }

  return (
    <FlatList
      data={templates}
      keyExtractor={(item) => item.id}
      style={styles.container}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      renderItem={({ item }) => (
        <Card style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.name}>{item.name}</Text>
            <Badge
              label={item.triggerType}
              color={colors.blue[600]}
              backgroundColor={colors.blue[50]}
            />
          </View>
          <Text style={styles.subject}>Subject: {item.subject}</Text>
          {item.stage ? (
            <Text style={styles.meta}>Stage: {item.stage}</Text>
          ) : null}
          {item.delayDays != null ? (
            <Text style={styles.meta}>
              Delay: {item.delayDays} day{item.delayDays === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
  },
  listContent: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[12],
  },
  card: {
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
    flex: 1,
  },
  subject: {
    ...fontSize.xs,
    color: colors.slate[600],
  },
  meta: {
    ...fontSize.xs,
    color: colors.slate[400],
  },
});
