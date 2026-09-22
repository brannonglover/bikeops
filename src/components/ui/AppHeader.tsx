import { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import {
  getHeaderTitle,
  type HeaderOptions,
} from "@react-navigation/elements";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { ShopLogo } from "@/components/ui/ShopLogo";

/** Gutter assumed for a centered title until the side slots have measured. */
const DEFAULT_SIDE_WIDTH = 96;

/**
 * Pure RN header — avoids iOS 26 UINavigationBar liquid-glass pills that
 * darken left+right together on press / push transitions.
 */
export function AppHeader({
  title,
  headerLeft,
  headerRight,
  headerTitle,
  titleAlign = "center",
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
  /**
   * `center` keeps the title optically centered in the bar; `left` hands it
   * every point the side slots don't need (chat threads, long customer names).
   */
  titleAlign?: "left" | "center";
  /** What to show on the left when headerLeft is omitted. */
  defaultLeft?: "logo" | "none";
  useShopBranding?: boolean;
  titleStyle?: StyleProp<TextStyle>;
  /** Taller header row for a centered brand logo title (customer home). */
  largeTitleLogo?: boolean;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [leftWidth, setLeftWidth] = useState(DEFAULT_SIDE_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_SIDE_WIDTH);
  const isLeftAligned = titleAlign === "left";

  const slotProps = { tintColor: theme.text } as never;
  const left = typeof headerLeft === "function" ? headerLeft(slotProps) : null;
  const right = typeof headerRight === "function" ? headerRight(slotProps) : null;

  const measure = (set: (w: number) => void) => (e: LayoutChangeEvent) =>
    set(Math.round(e.nativeEvent.layout.width));

  const plainTitleStyle = [
    styles.title,
    isLeftAligned && styles.titleLeft,
    { color: theme.text },
    titleStyle,
  ];

  let titleNode: React.ReactNode;
  if (typeof headerTitle === "function") {
    titleNode = headerTitle({
      children: title,
      tintColor: theme.text,
    });
  } else {
    titleNode = (
      <Text style={plainTitleStyle} numberOfLines={1}>
        {typeof headerTitle === "string" ? headerTitle : title}
      </Text>
    );
  }

  const leftSlot = (
    <View style={[styles.side, isLeftAligned && styles.sideAuto]}>
      <View style={styles.sideInner} onLayout={measure(setLeftWidth)}>
        {left ??
          (defaultLeft === "logo" ? (
            <View pointerEvents="none">
              <ShopLogo useShopBranding={useShopBranding} />
            </View>
          ) : null)}
      </View>
    </View>
  );

  const rightSlot = (
    <View
      style={[styles.side, styles.sideRight, isLeftAligned && styles.sideAuto]}
    >
      <View style={styles.sideInner} onLayout={measure(setRightWidth)}>
        {right}
      </View>
    </View>
  );

  // A centered title is absolutely positioned, so it has to reserve the wider
  // of the two side slots on both edges or it slides under their controls.
  const centeredGutter =
    largeTitleLogo || (defaultLeft === "none" && !left)
      ? spacing[4]
      : spacing[4] + Math.max(leftWidth, rightWidth) + spacing[2];

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
      <View style={[styles.headerRow, largeTitleLogo && styles.headerRowLarge]}>
        {leftSlot}
        {isLeftAligned ? (
          <View style={styles.titleLeftSlot} pointerEvents="box-none">
            {titleNode}
          </View>
        ) : (
          <View
            style={[
              styles.titleCenter,
              { left: centeredGutter, right: centeredGutter },
            ]}
            pointerEvents="box-none"
          >
            {titleNode}
          </View>
        )}
        {rightSlot}
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
      titleAlign={options.headerTitleAlign}
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
  /** A left-aligned title gets the leftover width, so the slots don't claim it. */
  sideAuto: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
  },
  sideInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  sideRight: {
    justifyContent: "flex-end",
  },
  titleCenter: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  titleLeftSlot: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    paddingHorizontal: spacing[2],
  },
  title: {
    ...fontSize.base,
    fontWeight: "700",
    textAlign: "center",
  },
  titleLeft: {
    textAlign: "left",
  },
});
