import { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Linking,
  StyleSheet,
} from "react-native";
import { resolveUrl } from "@/lib/api";
import { borderRadius, colors } from "@/lib/theme";

type OgData = {
  imageUrl: string | null;
  title: string | null;
};

type Props = {
  url: string;
};

export function LinkPreview({ url }: Props) {
  const [data, setData] = useState<OgData | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setData(null);
    setImgError(false);
    const controller = new AbortController();
    const endpoint =
      resolveUrl("/api/og-preview") + "?url=" + encodeURIComponent(url);
    fetch(endpoint, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: OgData) => {
        if (d.imageUrl) setData(d);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [url]);

  if (!data || !data.imageUrl || imgError) return null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => Linking.openURL(url)}
      style={styles.card}
    >
      <Image
        source={{ uri: data.imageUrl }}
        style={styles.image}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
      {data.title ? (
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {data.title}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    borderRadius: borderRadius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.slate[200],
    backgroundColor: "#ffffff",
  },
  image: {
    width: "100%",
    height: 160,
  },
  titleRow: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
});
