import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
}

export function EmptyState({ icon = "document-outline", title, message }: EmptyStateProps) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: spacing[8],
        gap: spacing[3],
      }}
    >
      <Ionicons name={icon} size={48} color={theme.iconMuted} />
      <Text
        style={{
          ...fontSize.lg,
          fontWeight: "600",
          color: theme.textTertiary,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            ...fontSize.sm,
            color: theme.textSecondary,
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}
