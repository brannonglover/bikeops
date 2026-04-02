import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, fontSize } from "@/lib/theme";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
}

export function EmptyState({ icon = "document-outline", title, message }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.slate[300]} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[8],
    gap: spacing[3],
  },
  title: {
    ...fontSize.lg,
    fontWeight: "600",
    color: colors.slate[700],
    textAlign: "center",
  },
  message: {
    ...fontSize.sm,
    color: colors.slate[500],
    textAlign: "center",
    maxWidth: 280,
  },
});
