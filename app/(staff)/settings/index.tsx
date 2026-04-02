import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Card } from "@/components/ui/Card";

const MENU_ITEMS = [
  { label: "Customers", icon: "people" as const, href: "/(staff)/settings/customers" },
  { label: "Services", icon: "build" as const, href: "/(staff)/settings/services" },
  { label: "Products", icon: "cube" as const, href: "/(staff)/settings/products" },
  { label: "Email Templates", icon: "mail" as const, href: "/(staff)/settings/email-templates" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { staffLogout, staffUser } = useAuth();

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await staffLogout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {staffUser ? (
        <Card style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={24} color={colors.white} />
          </View>
          <View>
            <Text style={styles.userName}>
              {staffUser.name ?? staffUser.email}
            </Text>
            <Text style={styles.userEmail}>{staffUser.email}</Text>
          </View>
        </Card>
      ) : null}

      <Card style={styles.menuCard}>
        {MENU_ITEMS.map((item, i) => (
          <TouchableOpacity
            key={item.href}
            onPress={() => router.push(item.href as never)}
            style={[styles.menuItem, i > 0 && styles.menuItemBorder]}
          >
            <Ionicons name={item.icon} size={20} color={colors.slate[500]} />
            <Text style={styles.menuLabel}>{item.label}</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.slate[400]}
            />
          </TouchableOpacity>
        ))}
      </Card>

      <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
        <Ionicons name="log-out-outline" size={20} color={colors.red[600]} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
    padding: spacing[4],
    gap: spacing[4],
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.slate[500],
    justifyContent: "center",
    alignItems: "center",
  },
  userName: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.slate[900],
  },
  userEmail: {
    ...fontSize.sm,
    color: colors.slate[500],
  },
  menuCard: {
    padding: 0,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
  },
  menuItemBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.slate[100],
  },
  menuLabel: {
    ...fontSize.base,
    color: colors.slate[900],
    flex: 1,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[4],
    backgroundColor: colors.red[50],
    borderRadius: borderRadius.xl,
  },
  logoutText: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.red[600],
  },
});
