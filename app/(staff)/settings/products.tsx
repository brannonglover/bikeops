import { useState } from "react";
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
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";

export default function ProductsScreen() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");

  const {
    data: products = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await api.get<Product[]>("/api/products");
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        stockQuantity: parseInt(stockQuantity, 10) || 0,
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
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description ?? "");
    setPrice(String(parseFloat(p.price)));
    setStockQuantity(String(p.stockQuantity));
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
      </View>

      {products.length === 0 ? (
        <EmptyState icon="cube-outline" title="No products" />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
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
              style={styles.row}
            >
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.productImage} />
              ) : (
                <View style={styles.productPlaceholder}>
                  <Ionicons name="cube-outline" size={20} color={colors.slate[300]} />
                </View>
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.rowDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
                <Text style={styles.stockText}>
                  Stock: {item.stockQuantity}
                </Text>
              </View>
              <Text style={styles.rowPrice}>
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
              <Ionicons name="close" size={24} color={colors.slate[500]} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <Input label="Name" value={name} onChangeText={setName} containerStyle={styles.inputGap} />
            <Input label="Description" value={description} onChangeText={setDescription} containerStyle={styles.inputGap} />
            <Input label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" containerStyle={styles.inputGap} />
            <Input label="Stock Quantity" value={stockQuantity} onChangeText={setStockQuantity} keyboardType="number-pad" containerStyle={styles.inputGap} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate[50] },
  toolbar: {
    padding: spacing[3],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[200],
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
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[100],
  },
  productImage: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[100],
  },
  productPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[100],
    justifyContent: "center",
    alignItems: "center",
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { ...fontSize.sm, fontWeight: "600", color: colors.slate[900] },
  rowDesc: { ...fontSize.xs, color: colors.slate[500] },
  stockText: { ...fontSize.xs, color: colors.slate[400] },
  rowPrice: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[700],
    fontVariant: ["tabular-nums"],
  },
  modalContainer: { flex: 1, backgroundColor: colors.white },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[200],
  },
  modalTitle: { ...fontSize.lg, fontWeight: "600", color: colors.slate[900] },
  modalContent: { padding: spacing[4] },
  inputGap: { marginBottom: spacing[3] },
});
