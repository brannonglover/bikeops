import { Stack } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { renderAppHeader } from "@/components/ui/AppHeader";

export default function SettingsLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        header: renderAppHeader,
        animation: "simple_push",
        customAnimationOnSwipe: true,
        headerTitleStyle: { fontWeight: "700", color: theme.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="products" options={{ title: "Products" }} />
      <Stack.Screen name="subscription" options={{ title: "Subscription" }} />
    </Stack>
  );
}
