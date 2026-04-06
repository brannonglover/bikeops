import { Stack } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { HamburgerMenu } from "@/components/ui/HamburgerMenu";
import { ShopLogo } from "@/components/ui/ShopLogo";

export default function ServicesLayout() {
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
      <Stack.Screen name="index" options={{ title: "Services" }} />
    </Stack>
  );
}
