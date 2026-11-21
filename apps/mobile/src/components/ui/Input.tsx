import { TextInput, View, Text, type TextInputProps, type ViewStyle } from "react-native";
import { colors, borderRadius, fontSize, spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, containerStyle, style, ...props }: InputProps) {
  const { theme } = useTheme();

  return (
    <View style={containerStyle}>
      {label ? (
        <Text style={{ ...fontSize.sm, fontWeight: "500", color: theme.textTertiary, marginBottom: spacing[1] }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        style={[
          {
            borderWidth: 1,
            borderColor: error ? colors.red[500] : theme.inputBorder,
            borderRadius: borderRadius.lg,
            paddingHorizontal: spacing[3],
            paddingVertical: spacing[2.5],
            fontSize: fontSize.base.fontSize,
            color: theme.inputText,
            backgroundColor: theme.inputBg,
          },
          style,
        ]}
        placeholderTextColor={theme.textMuted}
        {...props}
      />
      {error ? (
        <Text style={{ ...fontSize.xs, color: colors.red[600], marginTop: spacing[1] }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
