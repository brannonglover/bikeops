import { Stack } from "expo-router";
import { colors } from "@/lib/theme";

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: "700", color: colors.slate[900] },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="customers/index" options={{ title: "Customers" }} />
      <Stack.Screen name="customers/[id]" options={{ title: "Customer" }} />
      <Stack.Screen name="services" options={{ title: "Services" }} />
      <Stack.Screen name="products" options={{ title: "Products" }} />
      <Stack.Screen name="email-templates" options={{ title: "Email Templates" }} />
    </Stack>
  );
}
