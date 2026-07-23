import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme, type ThemeMode } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";

const THEME_OPTIONS: {
  mode: ThemeMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { mode: "light", label: "Light", icon: "sunny" },
  { mode: "dark", label: "Dark", icon: "moon" },
  { mode: "system", label: "System", icon: "phone-portrait-outline" },
];

export function AppearancePicker() {
  const { isDark, themeMode, setThemeMode, theme } = useTheme();

  return (
    <Card
      style={{
        padding: spacing[4],
        gap: spacing[3],
        backgroundColor: theme.surface,
        borderColor: theme.surfaceBorder,
      }}
    >
      <Text style={[styles.heading, { color: theme.textSecondary }]}>
        Appearance
      </Text>
      <View style={styles.row}>
        {THEME_OPTIONS.map((opt) => {
          const isActive = themeMode === opt.mode;
          return (
            <TouchableOpacity
              key={opt.mode}
              onPress={() => setThemeMode(opt.mode)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${opt.label} theme`}
              style={[
                styles.option,
                {
                  borderColor: isActive
                    ? colors.amber[500]
                    : theme.surfaceBorder,
                  backgroundColor: isActive
                    ? isDark
                      ? colors.amber[500] + "20"
                      : colors.amber[50]
                    : "transparent",
                },
              ]}
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
  );
}

const styles = StyleSheet.create({
  heading: {
    ...fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    gap: spacing[2],
  },
  option: {
    flex: 1,
    alignItems: "center",
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 2,
  },
});
