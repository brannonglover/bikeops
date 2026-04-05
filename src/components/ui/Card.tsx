import { View, type ViewStyle } from "react-native";
import { borderRadius, spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: borderRadius.xl,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          padding: spacing[4],
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: theme.dark ? 0.3 : 0.05,
          shadowRadius: 3,
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
