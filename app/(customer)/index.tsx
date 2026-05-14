import { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Job } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";

const ACTIVE_STAGES = new Set([
  "PENDING_APPROVAL",
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_PARTS",
  "BIKE_READY",
]);

export default function CustomerHomeScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { customerLogout } = useAuth();

  const handleLogout = async () => {
    await customerLogout();
    router.replace("/(auth)/login");
  };

  const { data: jobs } = useQuery({
    queryKey: ["customer-jobs"],
    queryFn: async () => {
      const { data } = await api.get<Job[]>("/api/customer/jobs", {
        role: "customer",
      });
      return data;
    },
  });

  const activeCount = useMemo(
    () => (jobs ?? []).filter((j) => ACTIVE_STAGES.has(j.stage)).length,
    [jobs]
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          padding: spacing[4],
          gap: spacing[3],
          paddingBottom: spacing[12],
        },
        greeting: {
          ...fontSize["2xl"],
          fontWeight: "700",
          color: theme.text,
          marginBottom: spacing[1],
        },
        subtitle: {
          ...fontSize.sm,
          color: theme.textSecondary,
          marginBottom: spacing[2],
        },
        menuCard: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[4],
        },
        iconCircle: {
          width: 48,
          height: 48,
          borderRadius: 24,
          justifyContent: "center",
          alignItems: "center",
        },
        cardContent: {
          flex: 1,
        },
        cardTitle: {
          ...fontSize.base,
          fontWeight: "600",
          color: theme.text,
        },
        cardDescription: {
          ...fontSize.sm,
          color: theme.textSecondary,
          marginTop: 2,
        },
        badgeRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
        },
        activeBadge: {
          backgroundColor: colors.amber[100],
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[0.5],
        },
        activeBadgeText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: colors.amber[700],
        },
        chevron: {
          marginLeft: "auto",
        },
      }),
    [theme]
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Home",
          headerRight: () => (
            <TouchableOpacity onPress={handleLogout} style={{ padding: spacing[1] }}>
              <Ionicons name="log-out-outline" size={22} color={theme.icon} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View>
          <Text style={styles.greeting}>Welcome</Text>
          <Text style={styles.subtitle}>What can we help you with?</Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push("/(customer)/book")}
        >
          <Card style={styles.menuCard}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.amber[100] },
              ]}
            >
              <Ionicons name="calendar-outline" size={24} color={colors.amber[600]} />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>Book a Repair</Text>
              <Text style={styles.cardDescription}>
                Schedule a new bike repair or service
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={theme.textMuted}
              style={styles.chevron}
            />
          </Card>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push("/(customer)/repairs")}
        >
          <Card style={styles.menuCard}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.blue[50] },
              ]}
            >
              <Ionicons name="bicycle-outline" size={24} color={colors.blue[600]} />
            </View>
            <View style={styles.cardContent}>
              <View style={styles.badgeRow}>
                <Text style={styles.cardTitle}>My Repairs</Text>
                {activeCount > 0 ? (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>
                      {activeCount} active
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardDescription}>
                View status and history of your repairs
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={theme.textMuted}
              style={styles.chevron}
            />
          </Card>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push("/(customer)/chat")}
        >
          <Card style={styles.menuCard}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.emerald[50] },
              ]}
            >
              <Ionicons
                name="chatbubbles-outline"
                size={24}
                color={colors.emerald[600]}
              />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>Chat</Text>
              <Text style={styles.cardDescription}>
                Message us with questions or updates
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={theme.textMuted}
              style={styles.chevron}
            />
          </Card>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}
