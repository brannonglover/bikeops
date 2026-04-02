import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { colors } from "@/lib/theme";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.slate[500]} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.slate[50],
    gap: 12,
  },
  text: {
    color: colors.slate[500],
    fontSize: 16,
  },
});
