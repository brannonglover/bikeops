import { View, Text, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme, type ThemeMode } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: "light", label: "Light", icon: "sunny" },
  { mode: "dark", label: "Dark", icon: "moon" },
  { mode: "system", label: "System", icon: "phone-portrait-outline" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { staffLogout, staffUser } = useAuth();
  const { isDark, themeMode, setThemeMode, resetTheme, theme } = useTheme();

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

      <Card style={{ padding: spacing[4], gap: spacing[3], backgroundColor: theme.surface, borderColor: theme.surfaceBorder }}>
        <Text style={{ ...fontSize.sm, fontWeight: "600", color: theme.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Appearance
        </Text>
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          {THEME_OPTIONS.map((opt) => {
            const isActive = themeMode === opt.mode;
            return (
              <TouchableOpacity
                key={opt.mode}
                onPress={() => setThemeMode(opt.mode)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: spacing[1.5],
                  paddingVertical: spacing[3],
                  borderRadius: borderRadius.xl,
                  borderWidth: 2,
                  borderColor: isActive ? colors.amber[500] : theme.surfaceBorder,
                  backgroundColor: isActive
                    ? (isDark ? colors.amber[500] + "20" : colors.amber[50])
                    : "transparent",
                }}
              >
                <Ionicons
                  name={opt.icon}
                  size={22}
                  color={isActive ? colors.amber[500] : theme.textMuted}
                />
                <Text
                  style={{
                    ...fontSize.sm,
                    fontWeight: isActive ? "600" : "400",
                    color: isActive ? colors.amber[500] : theme.textSecondary,
                  }}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

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
