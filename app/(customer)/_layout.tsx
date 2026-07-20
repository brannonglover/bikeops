import { TouchableOpacity } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { ShopLogo } from "@/components/ui/ShopLogo";

function HomeButton() {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <TouchableOpacity
      onPress={() => router.navigate("/(customer)/")}
      style={{ padding: spacing[1] }}
    >
      <Ionicons name="home-outline" size={22} color={theme.icon} />
    </TouchableOpacity>
  );
}

export default function CustomerLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.headerBg },
        headerLeftContainerStyle: { paddingLeft: spacing[4] },
        headerLeft: () => <ShopLogo />,
        headerTitleStyle: { fontWeight: "700", color: theme.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
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
        name="pay/[jobId]"
        options={{ title: "Pay", headerRight: () => <HomeButton /> }}
      />
    </Stack>
  );
}
