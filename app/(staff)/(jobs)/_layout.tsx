import { Stack } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { HamburgerMenu } from "@/components/ui/HamburgerMenu";
import { ShopLogo } from "@/components/ui/ShopLogo";

export default function JobsLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.headerBg,
        },
        headerTitleStyle: {
          fontWeight: "700",
          color: theme.text,
        },
        headerShadowVisible: true,
        headerLeft: () => <ShopLogo />,
        headerRight: () => <HamburgerMenu />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Job Board" }} />
      <Stack.Screen
        name="[id]"
        options={{
          title: "Job Detail",
          presentation: "card",
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="new"
        options={{ title: "New Job", presentation: "modal" }}
      />
    </Stack>
  );
}
