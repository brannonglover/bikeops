import { useState, useCallback } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type EmailTemplate } from "@/lib/types";
import { colors, spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function EmailTemplatesScreen() {
  const { theme } = useTheme();
  const {
    data: templates = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data } = await api.get<EmailTemplate[]>("/api/email-templates");
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

  if (isLoading) return <LoadingScreen message="Loading templates..." />;

  if (templates.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="mail-outline"
          title="No email templates"
          message="Templates are created via the web app."
        />
      </View>
    );
  }

  const badgeBg = theme.dark ? colors.blue[600] + "33" : colors.blue[50];
  const badgeColor = theme.dark ? colors.blue[100] : colors.blue[600];

  return (
    <FlatList
      data={templates}
      keyExtractor={(item) => item.id}
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
      }
      renderItem={({ item }) => (
        <Card style={styles.card}>
          <View style={styles.header}>
            <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
            <Badge label={item.triggerType} color={badgeColor} backgroundColor={badgeBg} />
          </View>
          <Text style={[styles.subject, { color: theme.textTertiary }]}>
            Subject: {item.subject}
          </Text>
          {item.stage ? (
            <Text style={[styles.meta, { color: theme.textMuted }]}>Stage: {item.stage}</Text>
          ) : null}
          {item.delayDays != null ? (
            <Text style={[styles.meta, { color: theme.textMuted }]}>
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
    flex: 1,
  },
  subject: {
    ...fontSize.xs,
  },
  meta: {
    ...fontSize.xs,
  },
});
