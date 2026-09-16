import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, StyleSheet, type LayoutChangeEvent } from "react-native";

const DURATION_MS = 220;

interface SlideDownProps {
  expanded: boolean;
  children: ReactNode;
}

/**
 * Accordion container that animates its own height to whatever the children
 * measure, so callers don't have to hardcode a panel height that breaks the
 * moment the content grows.
 *
 * Children stay unmounted while collapsed and are torn down only after the
 * close animation finishes — a voicemail player mounted for every row in the
 * call log would mean one audio player per row.
 */
export function SlideDown({ expanded, children }: SlideDownProps) {
  const [mounted, setMounted] = useState(expanded);
  const [contentHeight, setContentHeight] = useState(0);
  const height = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (expanded) setMounted(true);
  }, [expanded]);

  useEffect(() => {
    // Opening waits on measurement: animating to a height of 0 would read as
    // "nothing happened" on the first press.
    if (expanded && contentHeight === 0) return;

    const animation = Animated.parallel([
      Animated.timing(height, {
        toValue: expanded ? contentHeight : 0,
        duration: DURATION_MS,
        easing: expanded ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(translateY, {
        toValue: expanded ? 0 : -8,
        duration: DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(opacity, {
        toValue: expanded ? 1 : 0,
        duration: expanded ? DURATION_MS : DURATION_MS / 2,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished && !expanded) {
        setMounted(false);
        setContentHeight(0);
      }
    });

    return () => animation.stop();
  }, [expanded, contentHeight, height, translateY, opacity]);

  const onContentLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    // Re-measures matter while open: a transcript landing mid-session grows the
    // panel, and without this the extra lines would stay clipped.
    if (measured > 0 && Math.abs(measured - contentHeight) > 1) {
      setContentHeight(measured);
    }
  };

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.clip, { height }]}>
      <Animated.View
        onLayout={onContentLayout}
        style={[styles.content, { opacity, transform: [{ translateY }] }]}
      >
        <View>{children}</View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
});
