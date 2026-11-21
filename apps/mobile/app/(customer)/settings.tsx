import { View, Text, TouchableOpacity, Alert, StyleSheet } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { AppearancePicker } from "@/components/ui/AppearancePicker";

export default function CustomerSettingsScreen() {
  const router = useRouter();
  const { customerLogout } = useAuth();
  const { isDark, theme } = useTheme();

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await customerLogout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <AppearancePicker />

        <TouchableOpacity
          onPress={handleLogout}
          style={[
            styles.signOut,
            {
              backgroundColor: isDark ? colors.red[800] : colors.red[50],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons
            name="log-out-outline"
            size={20}
            color={isDark ? colors.red[300] : colors.red[600]}
          />
          <Text
            style={{
              ...fontSize.base,
              fontWeight: "600",
              color: isDark ? colors.red[300] : colors.red[600],
            }}
          >
            Sign Out
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing[4],
    gap: spacing[4],
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: borderRadius.xl,
  },
});
