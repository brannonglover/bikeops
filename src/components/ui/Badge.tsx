import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { colors, borderRadius, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { type Stage, STAGE_LABELS, STAGE_COLORS } from "@/lib/types";

interface BadgeProps {
  label: string;
  color: string;
  backgroundColor: string;
  style?: ViewStyle;
}

export function Badge({ label, color, backgroundColor, style }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor }, style]}>
      <Text numberOfLines={1} style={[styles.text, { color }]}>
        {label}
      </Text>
    </View>
  );
}

function humanizeStage(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StageBadge({ stage, style }: { stage: Stage | string; style?: ViewStyle }) {
  const color = STAGE_COLORS[stage as Stage] ?? colors.slate[600];
  return (
    <Badge
      label={STAGE_LABELS[stage as Stage] ?? humanizeStage(stage)}
      color={color}
      backgroundColor={color + "20"}
      style={style}
    />
  );
}

export function PaymentBadge({
  status,
  style,
}: {
  status: string;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const config: Record<string, { color: string; bg: string; label: string }> = {
    PAID: {
      color: colors.emerald[theme.dark ? 500 : 700],
      bg: theme.dark ? colors.emerald[800] + "55" : colors.emerald[50],
      label: "Paid",
    },
    PENDING: {
      color: colors.amber[theme.dark ? 400 : 700],
      bg: theme.dark ? colors.amber[800] + "55" : colors.amber[50],
      label: "Partially paid",
    },
    UNPAID: {
      color: theme.dark ? colors.slate[300] : colors.slate[600],
      bg: theme.dark ? colors.slate[700] : colors.slate[100],
      label: "Unpaid",
    },
    REFUNDED: {
      color: colors.red[theme.dark ? 500 : 700],
      bg: theme.dark ? colors.red[800] + "55" : colors.red[50],
      label: "Refunded",
    },
  };
  const c = config[status] ?? config.UNPAID;
  return <Badge label={c.label} color={c.color} backgroundColor={c.bg} style={style} />;
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.md,
    alignSelf: "flex-start",
    flexShrink: 0,
  },
  text: {
    ...fontSize.xs,
    fontWeight: "600",
  },
});
