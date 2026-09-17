import { memo } from "react";
import { Platform, Pressable, StyleSheet, Text, View, Vibration } from "react-native";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

/** The 12 keys of a phone keypad, with the letters printed under each. */
const KEYS: { digit: string; letters: string }[] = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

interface DialPadProps {
  onPress: (digit: string) => void;
  /** Holding 0 types "+" for international numbers. Off for in-call DTMF. */
  onLongPressZero?: (() => void) | null;
  /** Dark keys read better over the call screen's dark backdrop. */
  variant?: "surface" | "overlay";
}

/**
 * A plain 3x4 keypad. It owns no number state of its own — the dialer screen
 * appends to a buffer, the in-call pad sends DTMF — so both can share it.
 */
function DialPadComponent({ onPress, onLongPressZero, variant = "surface" }: DialPadProps) {
  const { theme } = useTheme();
  const overlay = variant === "overlay";

  const handlePress = (digit: string) => {
    // Matches the tactile feel of the system keypad. Android only: iOS has no
    // equivalent short vibration through Vibration, and haptics there would
    // mean pulling in another native module for one tap.
    if (Platform.OS === "android") Vibration.vibrate(10);
    onPress(digit);
  };

  return (
    <View style={styles.grid}>
      {KEYS.map(({ digit, letters }) => (
        <Pressable
          key={digit}
          onPress={() => handlePress(digit)}
          onLongPress={digit === "0" && onLongPressZero ? onLongPressZero : undefined}
          style={({ pressed }) => [
            styles.key,
            {
              backgroundColor: pressed
                ? overlay
                  ? colors.slate[600]
                  : theme.surfaceBorder
                : overlay
                  ? "rgba(255,255,255,0.12)"
                  : theme.surface,
              borderColor: overlay ? "transparent" : theme.surfaceBorder,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={digit === "*" ? "Star" : digit === "#" ? "Pound" : digit}
        >
          <Text
            style={[styles.keyDigit, { color: overlay ? colors.white : theme.text }]}
          >
            {digit}
          </Text>
          {letters ? (
            <Text
              style={[
                styles.keyLetters,
                { color: overlay ? colors.slate[300] : theme.textMuted },
              ]}
            >
              {letters}
            </Text>
          ) : (
            // Keeps every key the same height whether or not it prints letters.
            <View style={styles.keyLettersSpacer} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

export const DialPad = memo(DialPadComponent);

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing[3],
    maxWidth: 320,
    alignSelf: "center",
    width: "100%",
  },
  key: {
    // Three to a row, accounting for the two 12pt gaps between them.
    width: "30%",
    aspectRatio: 1.25,
    maxWidth: 92,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  keyDigit: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "400",
  },
  keyLetters: {
    ...fontSize.xs,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  keyLettersSpacer: { height: 12 },
});
