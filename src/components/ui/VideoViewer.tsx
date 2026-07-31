import { useEffect } from "react";
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, spacing } from "@/lib/theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

interface VideoViewerProps {
  uri: string | null;
  onClose: () => void;
}

export function VideoViewer({ uri, onClose }: VideoViewerProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (!uri) return;
    void player.replaceAsync(uri).then(() => {
      player.play();
    });
  }, [uri, player]);

  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <StatusBar barStyle="light-content" />
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={28} color={colors.white} />
        </TouchableOpacity>
        {uri ? (
          <VideoView
            player={player}
            style={styles.video}
            allowsFullscreen
            nativeControls
            contentFit="contain"
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: spacing[16],
    right: spacing[4],
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  video: {
    width: SCREEN_W,
    height: SCREEN_H * 0.75,
  },
});
