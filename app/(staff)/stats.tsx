import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type Stats } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Card } from "@/components/ui/Card";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatCurrency } from "@/lib/format";

const PERIODS = [
  { key: "day" as const, label: "Today" },
  { key: "week" as const, label: "This Week" },
  { key: "month" as const, label: "This Month" },
  { key: "year" as const, label: "This Year" },
] as const;

function RevenueBreakdown({
  stripe,
  cash,
  imported,
}: {
  stripe: number;
  cash: number;
  imported: number;
}) {
  const parts: { label: string; amount: number }[] = [];
  if (stripe > 0) parts.push({ label: "Stripe", amount: stripe });
  if (cash > 0) parts.push({ label: "Cash", amount: cash });
  if (imported > 0) parts.push({ label: "Imported", amount: imported });
  if (parts.length === 0) return null;
  return (
    <Text style={styles.breakdown}>
      {parts.map((p, i) => `${i > 0 ? " · " : ""}${p.label} ${formatCurrency(p.amount)}`).join("")}
    </Text>
  );
}

export default function StatsScreen() {
  const {
    data: stats,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const { data } = await api.get<Stats>("/api/stats");
      return data;
    },
  });

  if (isLoading || !stats) return <LoadingScreen message="Loading stats..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      <Text style={styles.description}>
        Completed bikes by when the job finished. Revenue uses recorded payments.
      </Text>

      {stats.lastYear ? (
        <Card style={styles.lastYear}>
          <Text style={styles.periodLabel}>
            {stats.lastYear.calendarYear} (full year)
          </Text>
          <Text style={styles.bigNumber}>
            {formatCurrency(stats.lastYear.revenue)}
          </Text>
          <Text style={styles.subLabel}>revenue</Text>
          <RevenueBreakdown
            stripe={stats.lastYear.stripeRevenue}
            cash={stats.lastYear.cashRevenue}
            imported={stats.lastYear.importedRevenue}
          />
        </Card>
      ) : null}

      {PERIODS.map(({ key, label }) => (
        <Card key={key} style={styles.periodCard}>
          <Text style={styles.periodLabel}>{label}</Text>
          <View style={styles.periodStats}>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{stats.bikes[key]}</Text>
              <Text style={styles.subLabel}>bikes completed</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>
                {formatCurrency(stats.revenue[key])}
              </Text>
              <Text style={styles.subLabel}>revenue</Text>
              <RevenueBreakdown
                stripe={stats.stripeRevenue?.[key] ?? 0}
                cash={stats.cashRevenue?.[key] ?? 0}
                imported={stats.importedRevenue[key]}
              />
            </View>
          </View>
        </Card>
      ))}

      {stats.topServices.length > 0 ? (
        <Card style={styles.servicesCard}>
          <Text style={styles.servicesTitle}>Top 5 Services</Text>
          {stats.topServices.map((svc, i) => (
            <View key={svc.name} style={styles.serviceRow}>
              <Text style={styles.serviceRank}>{i + 1}</Text>
              <Text style={styles.serviceName} numberOfLines={1}>
                {svc.name}
              </Text>
              <Text style={styles.serviceCount}>{svc.count}</Text>
              <Text style={styles.serviceRevenue}>
                {formatCurrency(svc.revenue)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
  },
  content: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[12],
  },
  description: {
    ...fontSize.sm,
    color: colors.slate[500],
    lineHeight: 20,
  },
  lastYear: {
    gap: spacing[1],
  },
  periodLabel: {
    ...fontSize.xs,
    fontWeight: "600",
    color: colors.slate[500],
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  bigNumber: {
    ...fontSize["2xl"],
    fontWeight: "700",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
  subLabel: {
    ...fontSize.sm,
    color: colors.slate[600],
  },
  breakdown: {
    ...fontSize.xs,
    color: colors.slate[500],
    marginTop: spacing[1],
  },
  periodCard: {
    gap: spacing[3],
  },
  periodStats: {
    gap: spacing[4],
  },
  stat: {
    gap: 2,
  },
  statNumber: {
    ...fontSize.xl,
    fontWeight: "700",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
  servicesCard: {
    gap: spacing[3],
  },
  servicesTitle: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.slate[900],
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[100],
  },
  serviceRank: {
    ...fontSize.sm,
    color: colors.slate[400],
    width: 20,
    fontVariant: ["tabular-nums"],
  },
  serviceName: {
    ...fontSize.sm,
    fontWeight: "500",
    color: colors.slate[900],
    flex: 1,
  },
  serviceCount: {
    ...fontSize.sm,
    color: colors.slate[600],
    fontVariant: ["tabular-nums"],
  },
  serviceRevenue: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
    minWidth: 70,
    textAlign: "right",
  },
});
