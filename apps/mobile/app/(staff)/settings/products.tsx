import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  Image,
  StyleSheet,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Product } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CatalogChips } from "@/components/ui/CatalogChips";
import { matchesCatalogChip } from "@/lib/catalog-chips";
import { formatCurrency } from "@/lib/format";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

/** Blank means no alert. */
function parseThreshold(value: string): number | null {
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function isLow(p: Product): boolean {
  return p.lowStockThreshold != null && p.stockQuantity <= p.lowStockThreshold;
}

export default function ProductsScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChip, setSelectedChip] = useState<string | null>(null);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.background },
        toolbar: {
          padding: spacing[3],
          gap: spacing[2],
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorder,
        },
        searchInput: {
          marginBottom: 0,
        },
        tabletConstrained: {
          width: "100%",
          maxWidth: 1040,
          alignSelf: "center",
        },
        addButton: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[1],
          paddingVertical: spacing[2],
          backgroundColor: colors.amber[500],
          borderRadius: borderRadius.lg,
        },
        addText: { ...fontSize.sm, fontWeight: "600", color: colors.white },
        listContent: { paddingBottom: spacing[12] },
        row: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          padding: spacing[4],
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorderSubtle,
        },
        rowTabletPortrait: {
          paddingVertical: spacing[5],
        },
        productImage: {
          width: 48,
          height: 48,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.placeholderBg,
        },
        productPlaceholder: {
          width: 48,
          height: 48,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.placeholderBg,
          justifyContent: "center",
          alignItems: "center",
        },
        rowInfo: { flex: 1, gap: 2 },
        rowName: { ...fontSize.sm, fontWeight: "600", color: theme.text },
        rowNameTabletPortrait: { ...fontSize.base },
        rowDesc: { ...fontSize.xs, color: theme.textSecondary },
        rowDescTabletPortrait: { ...fontSize.sm },
        stockText: { ...fontSize.xs, color: theme.textMuted },
        stockRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
        lowBadge: {
          paddingHorizontal: spacing[2],
          paddingVertical: 1,
          borderRadius: borderRadius.full,
          backgroundColor: colors.amber[100],
        },
        outBadge: { backgroundColor: colors.red[100] },
        lowBadgeText: { ...fontSize.xs, fontWeight: "600", color: colors.amber[800] },
        outBadgeText: { color: colors.red[800] },
        lowBanner: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
          paddingVertical: spacing[2],
          paddingHorizontal: spacing[3],
          borderRadius: borderRadius.lg,
          backgroundColor: colors.amber[50],
          borderWidth: 1,
          borderColor: colors.amber[200],
        },
        lowBannerText: { ...fontSize.sm, fontWeight: "600", color: colors.amber[800], flex: 1 },
        lowBannerAction: { ...fontSize.sm, fontWeight: "600", color: colors.amber[700] },
        hint: { ...fontSize.xs, color: theme.textMuted, marginTop: -spacing[2], marginBottom: spacing[3] },
        stockTextTabletPortrait: { ...fontSize.sm },
        rowPrice: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.textTertiary,
          fontVariant: ["tabular-nums"],
        },
        rowPriceTabletPortrait: { ...fontSize.base },
        productImageTabletPortrait: {
          width: 56,
          height: 56,
        },
        productPlaceholderTabletPortrait: {
          width: 56,
          height: 56,
        },
        modalContainer: { flex: 1, backgroundColor: theme.surface },
        modalHeader: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          padding: spacing[4],
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorder,
        },
        modalTitle: { ...fontSize.lg, fontWeight: "600", color: theme.text },
        modalContent: {
          padding: spacing[4],
          width: "100%",
          maxWidth: 720,
          alignSelf: "center" as const,
        },
        inputGap: { marginBottom: spacing[3] },
      }),
    [theme]
  );

  const {
    data: products = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await api.get<Product[]>("/api/products");
      return data;
    },
  });

  const searchedProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        (p.supplier?.toLowerCase().includes(q) ?? false)
    );
  }, [products, searchQuery]);

  const chipTexts = useMemo(
    () => searchedProducts.map((p) => `${p.name} ${p.description ?? ""}`),
    [searchedProducts]
  );
  const lowStockCount = useMemo(() => products.filter(isLow).length, [products]);
  const showLowOnly = lowOnly && lowStockCount > 0;
  const filteredProducts = useMemo(() => {
    const chipped = selectedChip
      ? searchedProducts.filter((_, i) => matchesCatalogChip(selectedChip, chipTexts[i]))
      : searchedProducts;
    return showLowOnly ? chipped.filter(isLow) : chipped;
  }, [searchedProducts, chipTexts, selectedChip, showLowOnly]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        stockQuantity: parseInt(stockQuantity, 10) || 0,
        lowStockThreshold: parseThreshold(lowStockThreshold),
      };
      if (editingId) {
        await api.patch(`/api/products/${editingId}`, body);
      } else {
        await api.post("/api/products", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      closeModal();
    },
    onError: (e) =>
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/products/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  const openNew = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrice("");
    setStockQuantity("0");
    setLowStockThreshold("");
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description ?? "");
    setPrice(String(parseFloat(p.price)));
    setStockQuantity(String(p.stockQuantity));
    setLowStockThreshold(p.lowStockThreshold == null ? "" : String(p.lowStockThreshold));
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  if (isLoading) return <LoadingScreen message="Loading products..." />;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={openNew} style={styles.addButton}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.addText}>Add Product</Text>
        </TouchableOpacity>
        <Input
          placeholder="Search products..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.searchInput}
        />
        {lowStockCount > 0 ? (
          <TouchableOpacity
            onPress={() => setLowOnly((v) => !v)}
            style={styles.lowBanner}
            accessibilityRole="button"
            accessibilityState={{ selected: showLowOnly }}
          >
            <Text style={styles.lowBannerText}>
              {lowStockCount === 1
                ? "1 product is running low"
                : `${lowStockCount} products are running low`}
            </Text>
            <Text style={styles.lowBannerAction}>{showLowOnly ? "Show all" : "Show"}</Text>
          </TouchableOpacity>
        ) : null}
        <CatalogChips texts={chipTexts} selected={selectedChip} onSelect={setSelectedChip} />
      </View>

      {products.length === 0 ? (
        <EmptyState icon="cube-outline" title="No products" />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title={
            searchedProducts.length > 0
              ? "No products match this filter"
              : `No products match "${searchQuery}"`
          }
        />
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => openEdit(item)}
              onLongPress={() => {
                Alert.alert("Delete", `Delete "${item.name}"?`, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => deleteMutation.mutate(item.id),
                  },
                ]);
              }}
              style={[styles.row, layout.isTablet && styles.tabletConstrained, layout.isTabletPortrait && styles.rowTabletPortrait]}
            >
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={[styles.productImage, layout.isTabletPortrait && styles.productImageTabletPortrait]} />
              ) : (
                <View style={[styles.productPlaceholder, layout.isTabletPortrait && styles.productPlaceholderTabletPortrait]}>
                  <Ionicons name="cube-outline" size={layout.isTabletPortrait ? 24 : 20} color={theme.iconMuted} />
                </View>
              )}
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, layout.isTabletPortrait && styles.rowNameTabletPortrait]}>{item.name}</Text>
                {item.description ? (
                  <Text style={[styles.rowDesc, layout.isTabletPortrait && styles.rowDescTabletPortrait]} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
                <View style={styles.stockRow}>
                  <Text style={[styles.stockText, layout.isTabletPortrait && styles.stockTextTabletPortrait]}>
                    Stock: {item.stockQuantity}
                  </Text>
                  {isLow(item) ? (
                    <View style={[styles.lowBadge, item.stockQuantity <= 0 && styles.outBadge]}>
                      <Text style={[styles.lowBadgeText, item.stockQuantity <= 0 && styles.outBadgeText]}>
                        {item.stockQuantity <= 0 ? "Out of stock" : "Low stock"}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Text style={[styles.rowPrice, layout.isTabletPortrait && styles.rowPriceTabletPortrait]}>
                {formatCurrency(item.price)}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {editingId ? "Edit Product" : "New Product"}
            </Text>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <Input label="Name" value={name} onChangeText={setName} containerStyle={styles.inputGap} />
            <Input label="Description" value={description} onChangeText={setDescription} containerStyle={styles.inputGap} />
            <Input label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" containerStyle={styles.inputGap} />
            <Input label="Stock Quantity" value={stockQuantity} onChangeText={setStockQuantity} keyboardType="number-pad" containerStyle={styles.inputGap} />
            <Input
              label="Alert me when stock is at or below"
              value={lowStockThreshold}
              onChangeText={setLowStockThreshold}
              keyboardType="number-pad"
              placeholder="No alert"
              containerStyle={styles.inputGap}
            />
            <Text style={styles.hint}>
              Staff get a notification when jobs use it down to this number. Leave blank for no alert.
            </Text>
            <Button
              title={editingId ? "Save" : "Create"}
              onPress={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={!name.trim() || !price}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
