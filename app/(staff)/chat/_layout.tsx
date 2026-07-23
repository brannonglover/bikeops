import { Stack, useRouter } from "expo-router";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { HamburgerMenu } from "@/components/ui/HamburgerMenu";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { renderAppHeader } from "@/components/ui/AppHeader";

export default function ChatLayout() {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        header: renderAppHeader,
        animation: "simple_push",
        customAnimationOnSwipe: true,
        headerTitleStyle: { fontWeight: "700", color: theme.text },
        headerRight: () => <HamburgerMenu />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Chat" }} />
      <Stack.Screen
        name="[id]"
        options={{
          title: "Conversation",
          headerLeft: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <TouchableOpacity
                onPress={() => router.navigate("/(staff)/chat")}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ padding: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Back to conversations"
              >
                <Ionicons name="chevron-back" size={24} color={theme.text} />
              </TouchableOpacity>
              <ShopLogo />
            </View>
          ),
        }}
      />
    </Stack>
  );
}
