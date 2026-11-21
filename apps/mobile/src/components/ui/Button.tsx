import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { colors, borderRadius, fontSize, spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  size?: "sm" | "md" | "lg";
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
  textStyle,
  size = "md",
}: ButtonProps) {
  const { theme } = useTheme();

  const variantStyles: Record<
    Variant,
    {
      bg: string;
      bgDisabled: string;
      text: string;
      textDisabled: string;
      border?: string;
    }
  > = {
    primary: {
      bg: colors.amber[600],
      bgDisabled: theme.subtleBg,
      text: colors.white,
      textDisabled: theme.textMuted,
    },
    secondary: {
      bg: theme.surface,
      bgDisabled: theme.subtleBg,
      text: theme.textTertiary,
      textDisabled: theme.textMuted,
      border: theme.inputBorder,
    },
    danger: {
      bg: colors.red[600],
      bgDisabled: theme.subtleBg,
      text: colors.white,
      textDisabled: theme.textMuted,
    },
    ghost: {
      bg: colors.transparent,
      bgDisabled: colors.transparent,
      text: theme.textTertiary,
      textDisabled: theme.textMuted,
    },
  };

  const v = variantStyles[variant];
  const isDisabled = disabled || loading;

  const sizeStyles = {
    sm: { paddingVertical: spacing[1.5], paddingHorizontal: spacing[3] },
    md: { paddingVertical: spacing[2.5], paddingHorizontal: spacing[4] },
    lg: { paddingVertical: spacing[3.5], paddingHorizontal: spacing[6] },
  };

  const fontSizes = {
    sm: fontSize.xs,
    md: fontSize.sm,
    lg: fontSize.base,
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        styles.base,
        sizeStyles[size],
        {
          backgroundColor: isDisabled ? v.bgDisabled : v.bg,
          borderColor: v.border ?? colors.transparent,
          borderWidth: v.border ? 1 : 0,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isDisabled ? v.textDisabled : v.text}
          style={{ marginRight: spacing[2] }}
        />
      ) : null}
      <Text
        style={[
          styles.text,
          fontSizes[size],
          { color: isDisabled ? v.textDisabled : v.text },
          textStyle,
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  text: {
    fontWeight: "600",
  },
});
