import { Stack } from "expo-router";
import { colors } from "@/lib/theme";

export default function CustomerLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: "700", color: colors.slate[900] },
      }}
    >
      <Stack.Screen name="book" options={{ title: "Book a Repair" }} />
      <Stack.Screen name="status/[jobId]" options={{ title: "Job Status" }} />
      <Stack.Screen name="chat" options={{ title: "Chat" }} />
      <Stack.Screen name="pay/[jobId]" options={{ title: "Pay" }} />
    </Stack>
  );
}
