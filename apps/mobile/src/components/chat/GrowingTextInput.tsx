import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fontSize } from "@/lib/theme";

const LINE_HEIGHT = fontSize.sm.lineHeight;
const DEFAULT_MAX_LINES = 3;

type GrowingTextInputProps = Omit<TextInputProps, "multiline" | "style"> & {
  /** Text used to measure height (controlled value, or mirrored uncontrolled text). */
  measureText: string;
  maxLines?: number;
  style?: StyleProp<TextStyle>;
  shellStyle?: StyleProp<ViewStyle>;
};

/**
 * Multiline TextInput that grows with content up to `maxLines`.
 * Uses a hidden Text mirror for height — more reliable than onContentSizeChange
 * on RN New Architecture / Fabric, where content-size events often don't fire.
 */
export function GrowingTextInput({
  measureText,
  maxLines = DEFAULT_MAX_LINES,
  style,
  shellStyle,
  scrollEnabled,
  ...rest
}: GrowingTextInputProps) {
  const minHeight = LINE_HEIGHT;
  const maxHeight = LINE_HEIGHT * maxLines;
  const [height, setHeight] = useState(minHeight);

  return (
    <View style={shellStyle}>
      <Text
        pointerEvents="none"
        style={[style, mirrorStyle, { maxHeight }]}
        onLayout={(e) => {
          const next = Math.ceil(e.nativeEvent.layout.height);
          const clamped = Math.min(Math.max(next, minHeight), maxHeight);
          setHeight((prev) => (prev === clamped ? prev : clamped));
        }}
      >
        {/* Trailing newline makes the last line measure; space keeps empty height. */}
        {measureText ? `${measureText}\u200b` : " "}
      </Text>
      <TextInput
        {...rest}
        multiline
        scrollEnabled={scrollEnabled ?? height >= maxHeight}
        style={[style, { height, width: "100%" }]}
      />
    </View>
  );
}

const mirrorStyle: TextStyle = {
  position: "absolute",
  opacity: 0,
  width: "100%",
};
