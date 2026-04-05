import { View, ActivityIndicator, Text } from "react-native";
import { useTheme } from "@/lib/ThemeContext";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.background,
        gap: 12,
      }}
    >
      <ActivityIndicator size="large" color={theme.textSecondary} />
      <Text style={{ color: theme.textSecondary, fontSize: 16 }}>{message}</Text>
    </View>
  );
}
