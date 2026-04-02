import { Stack } from "expo-router";
import { colors } from "@/lib/theme";

export default function JobsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTitleStyle: {
          fontWeight: "700",
          color: colors.slate[900],
        },
        headerShadowVisible: true,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Job Board" }} />
      <Stack.Screen
        name="[id]"
        options={{ title: "Job Detail", presentation: "card" }}
      />
      <Stack.Screen
        name="new"
        options={{ title: "New Job", presentation: "modal" }}
      />
    </Stack>
  );
}
