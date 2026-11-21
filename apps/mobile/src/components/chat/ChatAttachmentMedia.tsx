import { View, Image, TouchableOpacity, StyleSheet, type StyleProp, type ImageStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/lib/theme";

type ChatAttachmentMediaProps = {
  url: string;
  mimeType?: string;
  style: StyleProp<ImageStyle>;
  onPress: () => void;
  onLongPress?: () => void;
};

export function isVideoMimeType(mimeType?: string | null): boolean {
  return !!mimeType?.startsWith("video/");
}

export function ChatAttachmentMedia({
  url,
  mimeType,
  style,
  onPress,
  onLongPress,
}: ChatAttachmentMediaProps) {
  if (isVideoMimeType(mimeType)) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <View style={[style, styles.videoShell]}>
          <Ionicons name="play-circle" size={52} color={colors.white} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Image source={{ uri: url }} style={style} resizeMode="cover" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  videoShell: {
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
