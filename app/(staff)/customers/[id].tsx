import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  StyleSheet,
  Image,
  Linking,
  Modal,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer, type Bike } from "@/lib/types";
import { spacing, fontSize, borderRadius, colors } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { customerName, formatPhoneNumber, unformatPhoneNumber } from "@/lib/format";

export default function CustomerDetailScreen() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const {
    data: customer,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data } = await api.get<Customer>(`/api/customers/${id}`);

      if (!data.bikes || data.bikes.length === 0) {
        try {
          const { data: bikes } = await api.get<Bike[]>(
            `/api/customers/${id}/bikes`
          );
          if (Array.isArray(bikes) && bikes.length > 0) {
            data.bikes = bikes;
          }
        } catch {
          // Endpoint may not exist; bikes will remain empty
        }
      }

      setFirstName(data.firstName);
      setLastName(data.lastName ?? "");
      setEmail(data.email ?? "");
      setPhone(data.phone ?? "");
      setAddress(data.address ?? "");
      setNotes(data.notes ?? "");
      return data;
    },
    enabled: !!id,
  });

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const updateCustomer = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<Customer>(`/api/customers/${id}`, {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setEditing(false);
    },
    onError: (e) =>
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to update"),
  });

  const findDuplicates = async (): Promise<Customer[]> => {
    const trimmedFirst = firstName.trim().toLowerCase();
    const trimmedLast = lastName.trim().toLowerCase();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim().replace(/\D/g, "");

    const searches = new Set<string>();
    if (trimmedFirst) searches.add(trimmedFirst);
    if (trimmedEmail) searches.add(trimmedEmail);
    if (trimmedPhone) searches.add(trimmedPhone);

    const seen = new Set<string>();
    const matches: Customer[] = [];

    for (const q of searches) {
      const { data } = await api.get<Customer[]>(
        `/api/customers?q=${encodeURIComponent(q)}`
      );
      for (const c of data) {
        if (seen.has(c.id) || c.id === id) continue;
        const nameMatch =
          c.firstName.toLowerCase() === trimmedFirst &&
          (c.lastName?.toLowerCase() ?? "") === trimmedLast;
        const emailMatch =
          trimmedEmail && c.email?.toLowerCase() === trimmedEmail;
        const phoneMatch =
          trimmedPhone &&
          (c.phone?.replace(/\D/g, "") ?? "") === trimmedPhone;
        if (nameMatch || emailMatch || phoneMatch) {
          seen.add(c.id);
          matches.push(c);
        }
      }
    }
    return matches;
  };

  const handleSave = async () => {
    setCheckingDuplicate(true);
    let dupes: Customer[];
    try {
      dupes = await findDuplicates();
    } catch {
      setCheckingDuplicate(false);
      Alert.alert(
        "Unable to Check for Duplicates",
        "Please check your connection and try again."
      );
      return;
    } finally {
      setCheckingDuplicate(false);
    }
    if (dupes.length > 0) {
      const names = dupes
        .map((c) => {
          const parts = [customerName(c)];
          if (c.email) parts.push(c.email);
          if (c.phone) parts.push(c.phone);
          return `• ${parts.join(" — ")}`;
        })
        .join("\n");
      Alert.alert(
        "Customer Already Exists",
        `These changes would duplicate an existing customer:\n\n${names}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "View Existing",
            onPress: () => {
              setEditing(false);
              router.push(`/(staff)/customers/${dupes[0].id}`);
            },
          },
        ]
      );
    } else {
      updateCustomer.mutate();
    }
  };

  const deleteCustomer = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/customers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.back();
    },
    onError: (e) =>
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to delete"),
  });

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Customer",
      "This will permanently remove this customer and cannot be undone. Jobs and conversations linked to this customer may also be affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteCustomer.mutate(),
        },
      ]
    );
  }, [deleteCustomer]);

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [merging, setMerging] = useState(false);

  const { data: mergeResults = [] } = useQuery({
    queryKey: ["customers", "merge-search", mergeSearch],
    queryFn: async () => {
      if (!mergeSearch.trim()) return [];
      const { data } = await api.get<Customer[]>(
        `/api/customers?q=${encodeURIComponent(mergeSearch)}`
      );
      return data.filter((c) => c.id !== id);
    },
    enabled: showMergeModal && mergeSearch.trim().length > 0,
  });

  const handleMerge = useCallback(
    (target: Customer) => {
      Alert.alert(
        "Merge Customers",
        `This will move all jobs, bikes, and conversations from "${customerName(customer!)}" into "${customerName(target)}", then delete "${customerName(customer!)}". This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Merge",
            style: "destructive",
            onPress: async () => {
              setMerging(true);
              try {
                await api.post(`/api/customers/${target.id}/merge`, {
                  sourceCustomerId: id,
                });
                queryClient.invalidateQueries({ queryKey: ["customers"] });
                queryClient.invalidateQueries({
                  queryKey: ["customer", target.id],
                });
                setShowMergeModal(false);
                setMergeSearch("");
                router.replace(`/(staff)/customers/${target.id}`);
              } catch (e) {
                Alert.alert(
                  "Error",
                  e instanceof Error ? e.message : "Failed to merge customers"
                );
              } finally {
                setMerging(false);
              }
            },
          },
        ]
      );
    },
    [customer, id, queryClient, router]
  );

  if (isLoading || !customer) {
    return <LoadingScreen message="Loading customer..." />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: customerName(customer),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setEditing(!editing)}
              style={{ padding: spacing[2] }}
            >
              <Ionicons
                name={editing ? "close" : "create-outline"}
                size={20}
                color={theme.icon}
              />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
        }
      >
        {editing ? (
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
              Edit Customer
            </Text>
            <Input
              label="First Name"
              value={firstName}
              onChangeText={setFirstName}
              containerStyle={styles.inputGap}
            />
            <Input
              label="Last Name"
              value={lastName}
              onChangeText={setLastName}
              containerStyle={styles.inputGap}
            />
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              containerStyle={styles.inputGap}
            />
            <Input
              label="Phone"
              value={formatPhoneNumber(phone)}
              onChangeText={(text) => setPhone(unformatPhoneNumber(text))}
              keyboardType="phone-pad"
              containerStyle={styles.inputGap}
            />
            <Input
              label="Address"
              value={address}
              onChangeText={setAddress}
              containerStyle={styles.inputGap}
            />
            <Input
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: "top" }}
              containerStyle={styles.inputGap}
            />
            <Button
              title="Save"
              onPress={handleSave}
              loading={checkingDuplicate || updateCustomer.isPending}
              disabled={!firstName.trim()}
            />
          </Card>
        ) : (
          <>
            <Card style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
                Contact
              </Text>
              {customer.email ? (
                <TouchableOpacity
                  style={styles.infoRow}
                  onPress={() => Linking.openURL(`mailto:${customer.email}`)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="mail-outline" size={16} color={theme.dark ? colors.blue[100] : colors.blue[500]} />
                  <Text style={[styles.infoText, { color: theme.dark ? colors.blue[100] : colors.blue[500] }]}>
                    {customer.email}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {customer.phone ? (
                <TouchableOpacity
                  style={styles.infoRow}
                  onPress={() => Linking.openURL(`tel:${customer.phone}`)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="call-outline" size={16} color={theme.dark ? colors.blue[100] : colors.blue[500]} />
                  <Text style={[styles.infoText, { color: theme.dark ? colors.blue[100] : colors.blue[500] }]}>
                    {formatPhoneNumber(customer.phone)}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {customer.address ? (
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={16} color={theme.icon} />
                  <Text style={[styles.infoText, { color: theme.text }]}>
                    {customer.address}
                  </Text>
                </View>
              ) : null}
              {customer.notes ? (
                <View style={styles.infoRow}>
                  <Ionicons
                    name="document-text-outline"
                    size={16}
                    color={theme.icon}
                  />
                  <Text style={[styles.infoText, { color: theme.text }]}>
                    {customer.notes}
                  </Text>
                </View>
              ) : null}
            </Card>

            {customer.bikes && customer.bikes.length > 0 ? (
              <Card style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
                  Bikes ({customer.bikes.length})
                </Text>
                {customer.bikes.map((bike) => (
                  <View key={bike.id} style={styles.bikeRow}>
                    {bike.imageUrl ? (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setViewingImageUrl(bike.imageUrl!)}
                      >
                        <Image
                          source={{ uri: bike.imageUrl }}
                          style={[
                            styles.bikeImage,
                            { backgroundColor: theme.subtleBg },
                          ]}
                        />
                      </TouchableOpacity>
                    ) : (
                      <View
                        style={[
                          styles.bikePlaceholder,
                          { backgroundColor: theme.subtleBg },
                        ]}
                      >
                        <Ionicons name="bicycle" size={20} color={theme.iconMuted} />
                      </View>
                    )}
                    <View>
                      <Text style={[styles.bikeName, { color: theme.text }]}>
                        {bike.make} {bike.model}
                      </Text>
                      {bike.nickname ? (
                        <Text
                          style={[styles.bikeNickname, { color: theme.textSecondary }]}
                        >
                          {bike.nickname}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            <Button
              title="Open Chat"
              onPress={() =>
                router.push(`/(staff)/chat/index?customer=${customer.id}` as never)
              }
              variant="secondary"
            />
            <Button
              title="Merge into Another Customer..."
              onPress={() => setShowMergeModal(true)}
              variant="ghost"
            />
            <Button
              title="Delete Customer"
              onPress={handleDelete}
              loading={deleteCustomer.isPending}
              variant="danger"
            />
          </>
        )}
      </ScrollView>

      <Modal
        visible={showMergeModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMergeModal(false)}
      >
        <View
          style={[styles.modalContainer, { backgroundColor: theme.surface }]}
        >
          <View
            style={[
              styles.modalHeader,
              { borderBottomColor: theme.surfaceBorder },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              Merge into...
            </Text>
            <TouchableOpacity onPress={() => setShowMergeModal(false)}>
              <Ionicons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <Text style={[styles.mergeHint, { color: theme.textSecondary }]}>
              Search for the customer you want to keep. All data from{" "}
              {customerName(customer)} will be moved into the selected customer.
            </Text>
            <View
              style={[
                styles.mergeSearchRow,
                { backgroundColor: theme.subtleBg },
              ]}
            >
              <Ionicons name="search" size={18} color={theme.iconMuted} />
              <TextInput
                value={mergeSearch}
                onChangeText={setMergeSearch}
                placeholder="Search by name, email, or phone..."
                style={[styles.mergeSearchInput, { color: theme.text }]}
                placeholderTextColor={theme.textMuted}
                autoFocus
              />
            </View>
            {merging ? (
              <LoadingScreen message="Merging customers..." />
            ) : (
              <FlatList
                data={mergeResults}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleMerge(item)}
                    style={[
                      styles.mergeRow,
                      { borderBottomColor: theme.surfaceBorderSubtle },
                    ]}
                  >
                    <View style={styles.mergeAvatar}>
                      <Text style={styles.mergeInitial}>
                        {item.firstName[0]?.toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.mergeInfo}>
                      <Text
                        style={[styles.mergeName, { color: theme.text }]}
                      >
                        {customerName(item)}
                      </Text>
                      {item.email ? (
                        <Text
                          style={[
                            styles.mergeMeta,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {item.email}
                        </Text>
                      ) : null}
                      {item.phone ? (
                        <Text
                          style={[
                            styles.mergeMeta,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {formatPhoneNumber(item.phone)}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color={theme.iconMuted}
                    />
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.mergeList}
                ListEmptyComponent={
                  mergeSearch.trim() ? (
                    <Text
                      style={[
                        styles.mergeEmpty,
                        { color: theme.textMuted },
                      ]}
                    >
                      No matching customers found.
                    </Text>
                  ) : null
                }
              />
            )}
          </View>
        </View>
      </Modal>

      <ImageViewer uri={viewingImageUrl} onClose={() => setViewingImageUrl(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[12],
  },
  section: {
    gap: spacing[3],
  },
  sectionTitle: {
    ...fontSize.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inputGap: {
    marginBottom: spacing[2],
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  infoText: {
    ...fontSize.sm,
    flex: 1,
    lineHeight: 20,
  },
  bikeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  bikeImage: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
  },
  bikePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  bikeName: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  bikeNickname: {
    ...fontSize.xs,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[4],
    borderBottomWidth: 1,
  },
  modalTitle: {
    ...fontSize.lg,
    fontWeight: "600",
  },
  modalContent: {
    flex: 1,
    padding: spacing[4],
    gap: spacing[3],
  },
  mergeHint: {
    ...fontSize.sm,
    lineHeight: 20,
  },
  mergeSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
  },
  mergeSearchInput: {
    flex: 1,
    ...fontSize.sm,
    paddingVertical: spacing[2],
  },
  mergeList: {
    paddingBottom: spacing[12],
  },
  mergeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  mergeAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.amber[100],
    justifyContent: "center",
    alignItems: "center",
  },
  mergeInitial: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.amber[700],
  },
  mergeInfo: {
    flex: 1,
    gap: 1,
  },
  mergeName: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  mergeMeta: {
    ...fontSize.xs,
  },
  mergeEmpty: {
    ...fontSize.sm,
    textAlign: "center",
    paddingVertical: spacing[8],
  },
});
