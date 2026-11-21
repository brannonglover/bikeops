import { ScrollView, Text, TouchableOpacity, StyleSheet } from "react-native";
import { catalogChipCounts } from "@/lib/catalog-chips";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

/**
 * A horizontally scrolling row of filter chips (All, Tubes, Tires, Bearings,
 * …) for the Products and Services lists. Only chips that match at least one
 * of `texts` show. Meant to sit in a toolbar padded by spacing[3]: the row
 * bleeds to the screen edges so chips scroll off-screen instead of clipping.
 */
export function CatalogChips({
  texts,
  selected,
  onSelect,
}: {
  /** One searchable string per item in the list. */
  texts: readonly string[];
  selected: string | null;
  onSelect: (chipId: string | null) => void;
}) {
  const { theme } = useTheme();
  const chips = catalogChipCounts(texts, selected);
  if (chips.length === 0) return null;

  const items: { id: string | null; label: string; count?: number }[] = [
    { id: null, label: "All" },
    ...chips.map(({ chip, count }) => ({ id: chip.id, label: chip.label, count })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {items.map(({ id, label, count }) => {
        const active = selected === id;
        return (
          <TouchableOpacity
            key={id ?? "all"}
            onPress={() => onSelect(active && id !== null ? null : id)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.slate[700] : "transparent",
                borderColor: active ? colors.slate[700] : theme.surfaceBorder,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
          >
            <Text style={[styles.label, { color: active ? colors.white : theme.textSecondary }]}>
              {label}
              {count !== undefined ? (
                <Text style={{ color: active ? colors.slate[300] : theme.textMuted }}>{`  ${count}`}</Text>
              ) : null}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    marginHorizontal: -spacing[3],
  },
  row: {
    gap: spacing[2],
    paddingHorizontal: spacing[3],
  },
  chip: {
    paddingVertical: spacing[1.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  label: {
    ...fontSize.sm,
    fontWeight: "500",
  },
});
