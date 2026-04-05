import { Stack } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { ShopLogo } from "@/components/ui/ShopLogo";

export default function CustomerLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.headerBg },
        headerLeft: () => <ShopLogo />,
        headerTitleStyle: { fontWeight: "700", color: theme.text },
      }}
    >
      <Stack.Screen name="book" options={{ title: "Book a Repair" }} />
      <Stack.Screen name="status/[jobId]" options={{ title: "Job Status" }} />
      <Stack.Screen name="chat" options={{ title: "Chat" }} />
      <Stack.Screen name="pay/[jobId]" options={{ title: "Pay" }} />
    </Stack>
  );
}
