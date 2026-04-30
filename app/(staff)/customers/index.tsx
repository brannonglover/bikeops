import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  TextInput,
  Alert,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { customerName, formatPhoneNumber, unformatPhoneNumber } from "@/lib/format";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

export default function CustomersScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  const {
    data: customers = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["customers", search],
    queryFn: async () => {
      const q = search ? `?q=${encodeURIComponent(search)}` : "";
      const { data } = await api.get<Customer[]>(`/api/customers${q}`);
      return data;
    },
    placeholderData: keepPreviousData,
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

  const createCustomer = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Customer>("/api/customers", {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setShowNewModal(false);
      resetForm();
      router.push(`/(staff)/customers/${data.id}`);
    },
    onError: (e) =>
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to create"),
  });

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
  };

  const findDuplicates = async (
    excludeId?: string
  ): Promise<Customer[]> => {
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
        if (seen.has(c.id) || c.id === excludeId) continue;
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

  const handleCreate = async () => {
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
        `This customer matches an existing entry:\n\n${names}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "View Existing",
            onPress: () => {
              setShowNewModal(false);
              resetForm();
              router.push(`/(staff)/customers/${dupes[0].id}`);
            },
          },
        ]
      );
    } else {
      createCustomer.mutate();
    }
  };

  if (isLoading && !customers.length) return <LoadingScreen message="Loading customers..." />;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.toolbar,
          {
            backgroundColor: theme.surface,
            borderBottomColor: theme.surfaceBorder,
          },
        ]}
      >
        <View
          style={[
            styles.searchRow,
            { backgroundColor: theme.subtleBg },
          ]}
        >
          <Ionicons name="search" size={18} color={theme.iconMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customers..."
            style={[styles.searchInput, { color: theme.text }]}
            placeholderTextColor={theme.textMuted}
          />
        </View>
        <TouchableOpacity
          onPress={() => setShowNewModal(true)}
          style={styles.addButton}
        >
          <Ionicons name="add" size={20} color={colors.white} />
        </TouchableOpacity>
      </View>

      {customers.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No customers"
          message={search ? "No matches found." : "Add your first customer."}
        />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isManualRefresh} onRefresh={handleRefresh} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() =>
                router.push(`/(staff)/customers/${item.id}`)
              }
              style={[
                styles.customerRow,
                layout.isTablet && styles.tabletConstrained,
                {
                  backgroundColor: theme.surface,
                  borderBottomColor: theme.surfaceBorderSubtle,
                },
              ]}
            >
              <View style={styles.customerAvatar}>
                <Text style={styles.customerInitial}>
                  {item.firstName[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={[styles.customerRowName, { color: theme.text }]}>
                  {customerName(item)}
                </Text>
                {item.email ? (
                  <Text style={[styles.customerMeta, { color: theme.textSecondary }]}>
                    {item.email}
                  </Text>
                ) : null}
                {item.phone ? (
                  <Text style={[styles.customerMeta, { color: theme.textSecondary }]}>
                    {formatPhoneNumber(item.phone)}
                  </Text>
                ) : null}
                {item.bikes && item.bikes.length > 0 ? (
                  <View style={styles.bikeBadgeRow}>
                    <Ionicons name="bicycle" size={12} color={theme.textTertiary} />
                    <Text style={[styles.customerMeta, { color: theme.textTertiary }]}>
                      {item.bikes.length} {item.bikes.length === 1 ? "bike" : "bikes"}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.iconMuted}
              />
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal
        visible={showNewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNewModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.surface }]}>
          <View
            style={[
              styles.modalHeader,
              {
                borderBottomColor: theme.surfaceBorder,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              New Customer
            </Text>
            <TouchableOpacity onPress={() => setShowNewModal(false)}>
              <Ionicons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
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
            <Button
              title="Create Customer"
              onPress={handleCreate}
              loading={checkingDuplicate || createCustomer.isPending}
              disabled={!firstName.trim()}
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
  },
  toolbar: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
  },
  searchInput: {
    flex: 1,
    ...fontSize.sm,
    paddingVertical: spacing[2],
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.amber[500],
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    paddingBottom: spacing[12],
  },
  tabletConstrained: {
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
  },
  customerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  customerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.amber[100],
    justifyContent: "center",
    alignItems: "center",
  },
  customerInitial: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.amber[700],
  },
  customerInfo: {
    flex: 1,
    gap: 1,
  },
  customerRowName: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  customerMeta: {
    ...fontSize.xs,
  },
  bikeBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
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
    padding: spacing[4],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  inputGap: {
    marginBottom: spacing[3],
  },
});
