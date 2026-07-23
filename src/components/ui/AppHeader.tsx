import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import {
  getHeaderTitle,
  type HeaderOptions,
} from "@react-navigation/elements";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { ShopLogo } from "@/components/ui/ShopLogo";

/**
 * Pure RN header — avoids iOS 26 UINavigationBar liquid-glass pills that
 * darken left+right together on press / push transitions.
 */
export function AppHeader({
  title,
  headerLeft,
  headerRight,
  headerTitle,
  defaultLeft = "logo",
  useShopBranding = true,
  titleStyle,
  largeTitleLogo = false,
}: {
  title: string;
  headerLeft?: HeaderOptions["headerLeft"];
  headerRight?: HeaderOptions["headerRight"];
  /** Custom title element (function). When set, replaces the plain title text. */
  headerTitle?: HeaderOptions["headerTitle"];
  /** What to show on the left when headerLeft is omitted. */
  defaultLeft?: "logo" | "none";
  useShopBranding?: boolean;
  titleStyle?: StyleProp<TextStyle>;
  /** Taller header row for a centered brand logo title (customer home). */
  largeTitleLogo?: boolean;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const slotProps = { tintColor: theme.text } as never;
  const left = typeof headerLeft === "function" ? headerLeft(slotProps) : null;
  const right = typeof headerRight === "function" ? headerRight(slotProps) : null;

  let titleNode: React.ReactNode;
  if (typeof headerTitle === "function") {
    titleNode = headerTitle({
      children: title,
      tintColor: theme.text,
    });
  } else if (typeof headerTitle === "string") {
    titleNode = (
      <Text style={[styles.title, { color: theme.text }, titleStyle]} numberOfLines={1}>
        {headerTitle}
      </Text>
    );
  } else {
    titleNode = (
      <Text style={[styles.title, { color: theme.text }, titleStyle]} numberOfLines={1}>
        {title}
      </Text>
    );
  }

  return (
    <View
      style={[
        styles.headerWrap,
        {
          paddingTop: insets.top,
          backgroundColor: theme.headerBg,
          borderBottomColor: theme.surfaceBorder,
        },
      ]}
    >
      <View
        style={[styles.headerRow, largeTitleLogo && styles.headerRowLarge]}
      >
        <View style={styles.side}>
          {left ??
            (defaultLeft === "logo" ? (
              <View pointerEvents="none">
                <ShopLogo useShopBranding={useShopBranding} />
              </View>
            ) : null)}
        </View>
        <View
          style={[
            styles.titleCenter,
            (largeTitleLogo || (defaultLeft === "none" && !left)) &&
              styles.titleCenterWide,
          ]}
          pointerEvents="box-none"
        >
          {titleNode}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

/** Drop-in `header` renderer for Expo Router / native-stack screens. */
export function renderAppHeader({
  options,
  route,
}: NativeStackHeaderProps) {
  return (
    <AppHeader
      title={getHeaderTitle(options, route.name)}
      headerLeft={options.headerLeft}
      headerRight={options.headerRight}
      headerTitle={options.headerTitle}
      defaultLeft="logo"
      useShopBranding={true}
      titleStyle={
        options.headerTitleStyle &&
        typeof options.headerTitleStyle === "object" &&
        !Array.isArray(options.headerTitleStyle)
          ? (options.headerTitleStyle as TextStyle)
          : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: "visible",
    zIndex: 1,
  },
  headerRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
  },
  headerRowLarge: {
    minHeight: 60,
    paddingVertical: 0,
    overflow: "visible",
  },
  side: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 1,
  },
  sideRight: {
    justifyContent: "flex-end",
  },
  titleCenter: {
    position: "absolute",
    left: spacing[4] + 96,
    right: spacing[4] + 96,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  titleCenterWide: {
    left: spacing[4],
    right: spacing[4],
  },
  title: {
    ...fontSize.base,
    fontWeight: "700",
    textAlign: "center",
  },
});
