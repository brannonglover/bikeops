import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer, type Service } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { customerName, formatCurrency } from "@/lib/format";

export default function NewJobScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [bikes, setBikes] = useState([{ make: "", model: "" }]);
  const [notes, setNotes] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filteredServices = services.filter((svc) => {
    if (!serviceSearch.trim()) return true;
    const q = serviceSearch.toLowerCase();
    return (
      svc.name.toLowerCase().includes(q) ||
      (svc.description && svc.description.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    api
      .get<Service[]>("/api/services")
      .then(({ data }) => setServices(data.filter((s) => !s.isSystem)))
      .catch(() => {});
  }, []);

  const searchCustomers = async (q: string) => {
    setCustomerSearch(q);
    if (q.length < 1) {
      setCustomers([]);
      return;
    }
    try {
      const { data } = await api.get<Customer[]>(
        `/api/customers?q=${encodeURIComponent(q)}`
      );
      setCustomers(data);
    } catch {
      setCustomers([]);
    }
  };

  const updateBike = (index: number, field: "make" | "model", value: string) => {
    setBikes((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  };

  const addBike = () => setBikes((prev) => [...prev, { make: "", model: "" }]);

  const removeBike = (index: number) => {
    setBikes((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const hasValidBike = bikes.some((b) => b.make.trim() && b.model.trim());

  const handleSubmit = async () => {
    const validBikes = bikes.filter((b) => b.make.trim() && b.model.trim());
    if (validBikes.length === 0) {
      Alert.alert("Required", "At least one bike with make and model is required.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/jobs", {
        bikeMake: validBikes[0].make.trim(),
        bikeModel: validBikes[0].model.trim(),
        customerId: selectedCustomer?.id ?? null,
        notes: notes.trim() || null,
        serviceIds: selectedServiceIds,
        bikes: validBikes.map((b) => ({ make: b.make.trim(), model: b.model.trim() })),
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      router.back();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ alignItems: "center", justifyContent: "center", width: 32, height: 32 }}
            >
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView
          style={[styles.container, { backgroundColor: theme.background }]}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Customer */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
              Customer
            </Text>
            {selectedCustomer ? (
              <View
                style={[
                  styles.selectedCustomer,
                  { backgroundColor: theme.subtleBg },
                ]}
              >
                <View style={styles.selectedCustomerInfo}>
                  <Text style={[styles.selectedCustomerName, { color: theme.text }]}>
                    {customerName(selectedCustomer)}
                  </Text>
                  {selectedCustomer.email ? (
                    <Text style={[styles.meta, { color: theme.textSecondary }]}>
                      {selectedCustomer.email}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => setSelectedCustomer(null)}>
                  <Ionicons name="close-circle" size={20} color={theme.iconMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Input
                  placeholder="Search by name, email, or phone..."
                  value={customerSearch}
                  onChangeText={searchCustomers}
                  autoCapitalize="none"
                />
                {customers.length > 0 ? (
                  <View
                    style={[
                      styles.customerList,
                      { borderColor: theme.surfaceBorder },
                    ]}
                  >
                    {customers.slice(0, 5).map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => {
                          setSelectedCustomer(c);
                          setCustomerSearch("");
                          setCustomers([]);
                        }}
                        style={[
                          styles.customerOption,
                          { borderBottomColor: theme.surfaceBorderSubtle },
                        ]}
                      >
                        <Text style={[styles.customerOptionName, { color: theme.text }]}>
                          {customerName(c)}
                        </Text>
                        {c.email ? (
                          <Text
                            style={[
                              styles.customerOptionEmail,
                              { color: theme.textSecondary },
                            ]}
                          >
                            {c.email}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </Card>

          {/* Bikes */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
              {bikes.length === 1 ? "Bike" : "Bikes"}
            </Text>
            {bikes.map((bike, index) => (
              <View
                key={index}
                style={[
                  styles.bikeEntry,
                  index > 0 && { borderTopWidth: 1, borderTopColor: theme.surfaceBorderSubtle },
                ]}
              >
                {bikes.length > 1 && (
                  <View style={styles.bikeHeader}>
                    <Text style={[styles.bikeLabel, { color: theme.textSecondary }]}>
                      Bike {index + 1}
                    </Text>
                    <TouchableOpacity
                      onPress={() => removeBike(index)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.iconMuted} />
                    </TouchableOpacity>
                  </View>
                )}
                <Input
                  label="Make"
                  placeholder="e.g. Trek, Specialized"
                  value={bike.make}
                  onChangeText={(v) => updateBike(index, "make", v)}
                  containerStyle={styles.inputGap}
                />
                <Input
                  label="Model"
                  placeholder="e.g. Domane, Roubaix"
                  value={bike.model}
                  onChangeText={(v) => updateBike(index, "model", v)}
                />
              </View>
            ))}
            <TouchableOpacity onPress={addBike} style={styles.addBikeBtn}>
              <Ionicons name="add-circle-outline" size={20} color={colors.amber[600]} />
              <Text style={styles.addBikeText}>Add Bike</Text>
            </TouchableOpacity>
          </Card>

          {/* Services */}
          {services.length > 0 ? (
            <Card style={styles.section}>
              <View style={styles.sectionToggleLeft}>
                <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
                  Services
                </Text>
                {selectedServiceIds.length > 0 ? (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>
                      {selectedServiceIds.length} selected
                    </Text>
                  </View>
                ) : null}
              </View>
              <Input
                    placeholder="Search services..."
                    value={serviceSearch}
                    onChangeText={setServiceSearch}
                    autoCapitalize="none"
                  />
                  <ScrollView
                    style={styles.serviceList}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredServices.length > 0 ? (
                      filteredServices.map((svc) => {
                        const selected = selectedServiceIds.includes(svc.id);
                        return (
                          <TouchableOpacity
                            key={svc.id}
                            onPress={() => toggleService(svc.id)}
                            style={[
                              styles.serviceOption,
                              selected && styles.serviceOptionSelected,
                            ]}
                          >
                            <Ionicons
                              name={selected ? "checkbox" : "square-outline"}
                              size={20}
                              color={selected ? colors.amber[500] : theme.iconMuted}
                            />
                            <View style={styles.serviceInfo}>
                              <Text style={[styles.serviceName, { color: theme.text }]}>
                                {svc.name}
                              </Text>
                              {svc.description ? (
                                <Text
                                  style={[styles.serviceDesc, { color: theme.textSecondary }]}
                                  numberOfLines={1}
                                >
                                  {svc.description}
                                </Text>
                              ) : null}
                            </View>
                            <Text style={[styles.servicePrice, { color: theme.textTertiary }]}>
                              {formatCurrency(svc.price)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <Text style={[styles.noResults, { color: theme.textSecondary }]}>
                        No services match "{serviceSearch}"
                      </Text>
                    )}
                  </ScrollView>
            </Card>
          ) : null}

          {/* Notes */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
              Notes
            </Text>
            <Input
              placeholder="Any notes about the job..."
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: "top" }}
            />
          </Card>

          <Button
            title={submitting ? "Creating..." : "Create Job"}
            onPress={handleSubmit}
            loading={submitting}
            disabled={!hasValidBike}
            size="lg"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  bikeEntry: {
    gap: spacing[2],
    paddingTop: spacing[3],
  },
  bikeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bikeLabel: {
    ...fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  addBikeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
    paddingTop: spacing[1],
  },
  addBikeText: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.amber[600],
  },
  selectedCustomer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: borderRadius.lg,
    padding: spacing[3],
  },
  selectedCustomerInfo: {
    flex: 1,
  },
  selectedCustomerName: {
    ...fontSize.sm,
    fontWeight: "600",
  },
  meta: {
    ...fontSize.xs,
  },
  customerList: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
  },
  customerOption: {
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  customerOptionName: {
    ...fontSize.sm,
    fontWeight: "500",
  },
  customerOptionEmail: {
    ...fontSize.xs,
  },
  sectionToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flex: 1,
  },
  selectedBadge: {
    backgroundColor: colors.amber[100],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
  },
  selectedBadgeText: {
    ...fontSize.xs,
    fontWeight: "600",
    color: colors.amber[700],
  },
  serviceList: {
    maxHeight: 156,
  },
  noResults: {
    ...fontSize.sm,
    textAlign: "center",
    paddingVertical: spacing[4],
  },
  serviceOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
  },
  serviceOptionSelected: {
    backgroundColor: colors.amber[50],
  },
  serviceInfo: {
    flex: 1,
  },
  serviceName: {
    ...fontSize.sm,
    fontWeight: "500",
  },
  serviceDesc: {
    ...fontSize.xs,
  },
  servicePrice: {
    ...fontSize.sm,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
