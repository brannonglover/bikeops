import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  StyleSheet,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Service } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";

export default function ServicesScreen() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  const {
    data: services = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const { data } = await api.get<Service[]>("/api/services");
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
      };
      if (editingId) {
        await api.patch(`/api/services/${editingId}`, body);
      } else {
        await api.post("/api/services", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      closeModal();
    },
    onError: (e) =>
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/services/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["services"] }),
  });

  const openNew = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrice("");
    setShowModal(true);
  };

  const openEdit = (svc: Service) => {
    setEditingId(svc.id);
    setName(svc.name);
    setDescription(svc.description ?? "");
    setPrice(String(parseFloat(svc.price)));
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  const handleDelete = (svc: Service) => {
    Alert.alert("Delete", `Delete "${svc.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate(svc.id),
      },
    ]);
  };

  if (isLoading) return <LoadingScreen message="Loading services..." />;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={openNew} style={styles.addButton}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.addText}>Add Service</Text>
        </TouchableOpacity>
      </View>

      {services.length === 0 ? (
        <EmptyState icon="build-outline" title="No services" />
      ) : (
        <FlatList
          data={services}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => openEdit(item)}
              onLongPress={() => handleDelete(item)}
              style={styles.row}
            >
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.rowDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
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
              {editingId ? "Edit Service" : "New Service"}
            </Text>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="close" size={24} color={colors.slate[500]} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              containerStyle={styles.inputGap}
            />
            <Input
              label="Description"
              value={description}
              onChangeText={setDescription}
              containerStyle={styles.inputGap}
            />
            <Input
              label="Price"
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              containerStyle={styles.inputGap}
            />
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
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
  },
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
  addText: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.white,
  },
  listContent: {
    paddingBottom: spacing[12],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing[4],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[100],
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
  },
  rowDesc: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  rowPrice: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[700],
    fontVariant: ["tabular-nums"],
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.white,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[200],
  },
  modalTitle: {
    ...fontSize.lg,
    fontWeight: "600",
    color: colors.slate[900],
  },
  modalContent: {
    padding: spacing[4],
  },
  inputGap: {
    marginBottom: spacing[3],
  },
});
