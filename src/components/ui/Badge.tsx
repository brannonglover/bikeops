import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { colors, borderRadius, fontSize } from "@/lib/theme";
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
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

export function StageBadge({ stage, style }: { stage: Stage; style?: ViewStyle }) {
  const color = STAGE_COLORS[stage];
  return (
    <Badge
      label={STAGE_LABELS[stage]}
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
  const config: Record<string, { color: string; bg: string; label: string }> = {
    PAID: { color: colors.emerald[700], bg: colors.emerald[50], label: "Paid" },
    PENDING: { color: colors.amber[700], bg: colors.amber[50], label: "Pending" },
    UNPAID: { color: colors.slate[600], bg: colors.slate[100], label: "Unpaid" },
    REFUNDED: { color: colors.red[700], bg: colors.red[50], label: "Refunded" },
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
  },
  text: {
    ...fontSize.xs,
    fontWeight: "600",
  },
});
