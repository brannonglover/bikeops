import { useCallback, useEffect } from "react";
import { InteractionManager } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StripeTerminalProvider, useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import { colors, spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { HamburgerMenu } from "@/components/ui/HamburgerMenu";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { api } from "@/lib/api";

function StaffTabs() {
  const { theme } = useTheme();
  const { initialize } = useStripeTerminal();

  useEffect(() => {
    // Defer until after the first screen has finished rendering so the
    // heavy native Stripe Terminal SDK doesn't compete with initial paint.
    const task = InteractionManager.runAfterInteractions(() => {
      initialize();
    });
    return () => task.cancel();
  }, [initialize]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.amber[600],
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          borderTopColor: theme.tabBarBorder,
          backgroundColor: theme.tabBarBg,
        },
        headerStyle: {
          backgroundColor: theme.headerBg,
          shadowColor: theme.surfaceBorder,
          shadowOpacity: 1,
          shadowOffset: { width: 0, height: 1 },
          shadowRadius: 0,
          elevation: 1,
        },
        headerTitleStyle: {
          fontWeight: "700",
          color: theme.text,
        },
        headerLeftContainerStyle: {
          paddingLeft: spacing[4],
        },
        headerRightContainerStyle: {
          paddingRight: spacing[4],
        },
        headerLeft: () => <ShopLogo />,
        headerRight: () => <HamburgerMenu />,
      }}
    >
      <Tabs.Screen
        name="(jobs)"
        options={{
          title: "Jobs",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="construct" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: "Customers",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          title: "Services",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="build" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="archive"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}

async function fetchConnectionToken(): Promise<string> {
  const { data } = await api.post<{ secret: string }>("/api/terminal/connection-token");
  return data.secret;
}

export default function StaffLayout() {
  const tokenProvider = useCallback(fetchConnectionToken, []);

  return (
    <StripeTerminalProvider logLevel="none" tokenProvider={tokenProvider}>
      <StaffTabs />
    </StripeTerminalProvider>
  );
}
