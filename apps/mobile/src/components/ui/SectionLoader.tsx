import { View, StyleSheet } from "react-native";
import { spacing } from "@/lib/theme";
import { BikeLoader } from "@/components/ui/BikeLoader";

/** Inline section placeholder — bike animation + label while a chunk loads. */
export function SectionLoader({ label }: { label: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label}>
      <BikeLoader label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[6],
    gap: spacing[2],
  },
});
