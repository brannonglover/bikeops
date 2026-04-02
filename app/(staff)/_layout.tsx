import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/lib/theme";

export default function StaffLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.amber[600],
        tabBarInactiveTintColor: colors.slate[400],
        tabBarStyle: {
          borderTopColor: colors.slate[200],
          backgroundColor: colors.white,
        },
        headerStyle: {
          backgroundColor: colors.white,
          shadowColor: colors.slate[200],
          shadowOpacity: 1,
          shadowOffset: { width: 0, height: 1 },
          shadowRadius: 0,
          elevation: 1,
        },
        headerTitleStyle: {
          fontWeight: "700",
          color: colors.slate[900],
        },
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
        name="archive"
        options={{
          title: "Archive",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="archive" size={size} color={color} />
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
        name="stats"
        options={{
          title: "Stats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
