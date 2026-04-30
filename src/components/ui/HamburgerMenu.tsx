import { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

const MENU_ITEMS = [
  {
    label: "Products",
    icon: "cube" as const,
    href: "/(staff)/settings/products",
  },
  {
    label: "Stats",
    icon: "bar-chart" as const,
    href: "/(staff)/stats",
  },
  {
    label: "Archive",
    icon: "archive" as const,
    href: "/(staff)/archive",
  },
  {
    label: "Settings",
    icon: "settings" as const,
    href: "/(staff)/settings",
  },
];

export function HamburgerMenu() {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const router = useRouter();
  const { theme } = useTheme();

  const open = useCallback(() => {
    setVisible(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  const close = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }, [opacity]);

  const navigate = useCallback(
    (href: string) => {
      close();
      setTimeout(() => router.push(href as never), 160);
    },
    [close, router],
  );

  return (
    <>
      <View style={styles.triggerWrap}>
        <TouchableOpacity
          onPress={open}
          hitSlop={12}
          style={[
            styles.trigger,
            { backgroundColor: theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)" },
          ]}
        >
          <Ionicons name="menu" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Animated.View
            style={[
              styles.dropdown,
              {
                opacity,
                backgroundColor: theme.surface,
                shadowColor: "#000",
                shadowOpacity: theme.dark ? 0.4 : 0.15,
              },
            ]}
          >
            {MENU_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={item.href}
                onPress={() => navigate(item.href)}
                style={[
                  styles.menuItem,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.surfaceBorder },
                ]}
                activeOpacity={0.6}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={theme.icon}
                />
                <Text style={[styles.menuLabel, { color: theme.text }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerWrap: {
    marginRight: spacing[0],
    justifyContent: "center",
  },
  trigger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },
  dropdown: {
    marginTop: 100,
    marginRight: spacing[3],
    borderRadius: borderRadius.xl,
    minWidth: 210,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  menuLabel: {
    ...fontSize.base,
  },
});
