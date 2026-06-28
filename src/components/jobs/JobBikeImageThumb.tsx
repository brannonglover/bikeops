import {
  View,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

type JobBikeImageThumbSize = "compact" | "regular";

interface JobBikeImageThumbProps {
  imageUrl: string | null;
  isUploading?: boolean;
  editable?: boolean;
  size?: JobBikeImageThumbSize;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<
  JobBikeImageThumbSize,
  { dimension: number; placeholderIcon: number; badge: number; badgeIcon: number }
> = {
  compact: { dimension: 56, placeholderIcon: 22, badge: 22, badgeIcon: 12 },
  regular: { dimension: 84, placeholderIcon: 28, badge: 26, badgeIcon: 14 },
};

export function JobBikeImageThumb({
  imageUrl,
  isUploading = false,
  editable = false,
  size = "regular",
  onPress,
  style,
}: JobBikeImageThumbProps) {
  const { theme } = useTheme();
  const dims = SIZES[size];
  const imageStyle = {
    width: dims.dimension,
    height: dims.dimension,
    borderRadius: borderRadius.xl,
    backgroundColor: theme.placeholderBg,
  };

  const content = (
    <View style={[styles.wrap, style]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={imageStyle} />
      ) : (
        <View style={[imageStyle, styles.placeholder]}>
          <Ionicons name="bicycle" size={dims.placeholderIcon} color={theme.iconMuted} />
        </View>
      )}
      {editable && isUploading ? (
        <View style={[styles.uploadOverlay, imageStyle]}>
          <ActivityIndicator size="small" color={colors.white} />
        </View>
      ) : editable ? (
        <View
          style={[
            styles.badge,
            {
              width: dims.badge,
              height: dims.badge,
              bottom: size === "regular" ? spacing[1] : 2,
              right: size === "regular" ? spacing[1] : 2,
            },
          ]}
        >
          <Ionicons name="camera" size={dims.badgeIcon} color={colors.white} />
        </View>
      ) : null}
    </View>
  );

  if (editable && onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel={imageUrl ? "Change bike photo" : "Add bike photo"}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    borderRadius: borderRadius.full,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
});
