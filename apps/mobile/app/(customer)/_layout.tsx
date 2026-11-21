import { Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getHeaderTitle } from "@react-navigation/elements";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { AppHeader } from "@/components/ui/AppHeader";
import { ShopLogo } from "@/components/ui/ShopLogo";

function renderCustomerHeader({ options, route }: NativeStackHeaderProps) {
  const isHome = route.name === "index";

  return (
    <AppHeader
      title={getHeaderTitle(options, route.name)}
      headerLeft={options.headerLeft}
      headerRight={options.headerRight}
      headerTitle={
        isHome
          ? () => <ShopLogo useShopBranding={false} size="lg" />
          : options.headerTitle
      }
      defaultLeft={isHome ? "none" : "logo"}
      largeTitleLogo={isHome}
      useShopBranding={
        route.name !== "index" &&
        route.name !== "profile" &&
        route.name !== "settings" &&
        route.name !== "repairs" &&
        route.name !== "status/[jobId]"
      }
    />
  );
}

function HomeButton() {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.navigate("/(customer)/")}
      hitSlop={8}
      style={({ pressed }) => ({
        padding: spacing[1],
        opacity: pressed ? 0.55 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel="Home"
    >
      <Ionicons name="home-outline" size={22} color={theme.icon} />
    </Pressable>
  );
}

export default function CustomerLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        header: renderCustomerHeader,
        animation: "simple_push",
        customAnimationOnSwipe: true,
        headerTitleStyle: { fontWeight: "700", color: theme.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Bike Ops" }} />
      <Stack.Screen
        name="book"
        options={{ title: "Book a Repair", headerRight: () => <HomeButton /> }}
      />
      <Stack.Screen
        name="repairs"
        options={{ title: "My Repairs", headerRight: () => <HomeButton /> }}
      />
      <Stack.Screen
        name="status/[jobId]"
        options={{ title: "Job Status", headerRight: () => <HomeButton /> }}
      />
      <Stack.Screen
        name="chat"
        options={{ title: "Chat", headerRight: () => <HomeButton /> }}
      />
      <Stack.Screen
        name="profile"
        options={{ title: "Profile", headerRight: () => <HomeButton /> }}
      />
      <Stack.Screen
        name="settings"
        options={{ title: "Settings", headerRight: () => <HomeButton /> }}
      />
      <Stack.Screen
        name="pay/[jobId]"
        options={{ title: "Pay", headerRight: () => <HomeButton /> }}
      />
    </Stack>
  );
}
