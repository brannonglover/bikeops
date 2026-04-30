import { Stack } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { ShopLogo } from "@/components/ui/ShopLogo";

export default function SettingsLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.headerBg },
        headerLeft: () => <ShopLogo />,
        headerTitleStyle: { fontWeight: "700", color: theme.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="products" options={{ title: "Products" }} />
    </Stack>
  );
}
