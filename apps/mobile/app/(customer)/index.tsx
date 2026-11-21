import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCustomerProfile } from "@/lib/customer-profile";
import {
  customerJobsSummaryQueryKey,
  fetchCustomerJobsSummary,
  getCustomerLoadPriority,
  prioritizeCustomerDestination,
  subscribeCustomerLoadPriority,
  type CustomerDestination,
  type CustomerJobSummary,
} from "@/lib/customer-load-priority";
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

type MenuItem = {
  key: Exclude<CustomerDestination, "home">;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBgLight: string;
  iconBgDark: string;
  iconColor: string;
  href:
    | "/(customer)/book"
    | "/(customer)/repairs"
    | "/(customer)/chat"
    | "/(customer)/profile"
    | "/(customer)/settings";
  showActiveBadge?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  {
    key: "book",
    title: "Book a Repair",
    description: "Schedule a new bike repair or service",
    icon: "calendar-outline",
    iconBgLight: colors.amber[100],
    iconBgDark: colors.amber[500] + "22",
    iconColor: colors.amber[600],
    href: "/(customer)/book",
  },
  {
    key: "repairs",
    title: "My Repairs",
    description: "View status and history of your repairs",
    icon: "bicycle-outline",
    iconBgLight: colors.blue[50],
    iconBgDark: colors.blue[500] + "22",
    iconColor: colors.blue[600],
    href: "/(customer)/repairs",
    showActiveBadge: true,
  },
  {
    key: "chat",
    title: "Chat",
    description: "Message us with questions or updates",
    icon: "chatbubbles-outline",
    iconBgLight: colors.emerald[50],
    iconBgDark: colors.emerald[500] + "22",
    iconColor: colors.emerald[600],
    href: "/(customer)/chat",
  },
  {
    key: "profile",
    title: "Profile",
    description: "Your contact info and bikes",
    icon: "person-outline",
    iconBgLight: colors.purple[50],
    iconBgDark: colors.purple[500] + "22",
    iconColor: colors.purple[600],
    href: "/(customer)/profile",
  },
  {
    key: "settings",
    title: "Settings",
    description: "Appearance and account",
    icon: "settings-outline",
    iconBgLight: colors.slate[100],
    iconBgDark: colors.slate[700],
    iconColor: colors.slate[600],
    href: "/(customer)/settings",
  },
];

export default function CustomerHomeScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [greetingName, setGreetingName] = useState<string | null>(null);
  const [loadPriority, setLoadPriority] = useState<CustomerDestination>(
    getCustomerLoadPriority
  );

  useEffect(() => subscribeCustomerLoadPriority(setLoadPriority), []);

  useFocusEffect(
    useCallback(() => {
      prioritizeCustomerDestination(queryClient, "home");
    }, [queryClient])
  );

  const openDestination = useCallback(
    (item: MenuItem) => {
      prioritizeCustomerDestination(queryClient, item.key);
      router.push(item.href);
    },
    [queryClient, router]
  );

  // Never block the menu on SecureStore — it can hang at cold start until the
  // app is backgrounded. Paint "Welcome" immediately; fill the name when ready.
  useEffect(() => {
    let cancelled = false;
    void getCustomerProfile()
      .then((profile) => {
        if (cancelled) return;
        const name = profile.firstName.trim();
        setGreetingName(name || null);
      })
      .catch(() => {
        // Keep generic Welcome.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const homeBackgroundAllowed = loadPriority === "home";
  const cachedSummary = queryClient.getQueryData<CustomerJobSummary[]>(
    customerJobsSummaryQueryKey
  );

  const { data: jobSummary } = useQuery({
    queryKey: customerJobsSummaryQueryKey,
    queryFn: fetchCustomerJobsSummary,
    enabled: homeBackgroundAllowed,
    initialData: cachedSummary,
  });

  const activeCount = useMemo(
    () =>
      (jobSummary ?? []).filter((j: CustomerJobSummary) =>
        ACTIVE_STAGES.has(j.stage)
      ).length,
    [jobSummary]
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
          backgroundColor: theme.dark
            ? colors.amber[800] + "55"
            : colors.amber[100],
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[0.5],
        },
        activeBadgeText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.dark ? colors.amber[400] : colors.amber[700],
        },
        chevron: {
          marginLeft: "auto",
        },
      }),
    [theme]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View>
        <Text style={styles.greeting}>
          {greetingName ? `Welcome, ${greetingName}` : "Welcome"}
        </Text>
        <Text style={styles.subtitle}>What can we help you with?</Text>
      </View>

      {MENU_ITEMS.map((item) => (
        <TouchableOpacity
          key={item.key}
          activeOpacity={0.7}
          onPress={() => openDestination(item)}
        >
          <Card style={styles.menuCard}>
            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor: theme.dark
                    ? item.iconBgDark
                    : item.iconBgLight,
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={24}
                color={
                  theme.dark && item.key === "settings"
                    ? colors.slate[300]
                    : item.iconColor
                }
              />
            </View>
            <View style={styles.cardContent}>
              <View style={styles.badgeRow}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {item.showActiveBadge && activeCount > 0 ? (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>
                      {activeCount} active
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardDescription}>{item.description}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={theme.textMuted}
              style={styles.chevron}
            />
          </Card>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
