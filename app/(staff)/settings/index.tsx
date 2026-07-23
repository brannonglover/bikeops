import { View, Text, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { AppearancePicker } from "@/components/ui/AppearancePicker";

export default function SettingsScreen() {
  const router = useRouter();
  const { staffLogout, staffUser } = useAuth();
  const { isDark, resetTheme, theme } = useTheme();

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          resetTheme();
          await staffLogout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: spacing[4], gap: spacing[4] }}>
      {staffUser ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing[3], backgroundColor: theme.surface, borderColor: theme.surfaceBorder }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: theme.textSecondary,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Ionicons name="person" size={24} color={colors.white} />
          </View>
          <View>
            <Text style={{ ...fontSize.base, fontWeight: "600", color: theme.text }}>
              {staffUser.name ?? staffUser.email}
            </Text>
            <Text style={{ ...fontSize.sm, color: theme.textSecondary }}>{staffUser.email}</Text>
          </View>
        </Card>
      ) : null}

      <AppearancePicker />

      <TouchableOpacity onPress={() => router.push("/(staff)/settings/subscription")}>
        <Card
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[3],
            backgroundColor: theme.surface,
            borderColor: theme.surfaceBorder,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.amber[500] + "22",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Ionicons name="card-outline" size={22} color={colors.amber[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...fontSize.base, fontWeight: "600", color: theme.text }}>
              Subscription
            </Text>
            <Text style={{ ...fontSize.sm, color: theme.textSecondary }}>
              View your plan or subscribe
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </Card>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleLogout}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[2],
          padding: spacing[4],
          backgroundColor: isDark ? colors.red[800] : colors.red[50],
          borderRadius: borderRadius.xl,
        }}
      >
        <Ionicons name="log-out-outline" size={20} color={isDark ? colors.red[300] : colors.red[600]} />
        <Text style={{ ...fontSize.base, fontWeight: "600", color: isDark ? colors.red[300] : colors.red[600] }}>
          Sign Out
        </Text>
      </TouchableOpacity>
    </View>
  );
}
