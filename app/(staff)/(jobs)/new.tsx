import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer, type Service } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { customerName, formatCurrency } from "@/lib/format";

export default function NewJobScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [bikeMake, setBikeMake] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!bikeMake.trim() || !bikeModel.trim()) {
      Alert.alert("Required", "Bike make and model are required.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/jobs", {
        bikeMake: bikeMake.trim(),
        bikeModel: bikeModel.trim(),
        customerId: selectedCustomer?.id ?? null,
        notes: notes.trim() || null,
        serviceIds: selectedServiceIds,
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
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: colors.slate[500], fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Customer */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Customer</Text>
          {selectedCustomer ? (
            <View style={styles.selectedCustomer}>
              <View style={styles.selectedCustomerInfo}>
                <Text style={styles.selectedCustomerName}>
                  {customerName(selectedCustomer)}
                </Text>
                {selectedCustomer.email ? (
                  <Text style={styles.meta}>{selectedCustomer.email}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => setSelectedCustomer(null)}>
                <Ionicons name="close-circle" size={20} color={colors.slate[400]} />
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
                <View style={styles.customerList}>
                  {customers.slice(0, 5).map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => {
                        setSelectedCustomer(c);
                        setCustomerSearch("");
                        setCustomers([]);
                      }}
                      style={styles.customerOption}
                    >
                      <Text style={styles.customerOptionName}>
                        {customerName(c)}
                      </Text>
                      {c.email ? (
                        <Text style={styles.customerOptionEmail}>{c.email}</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </Card>

        {/* Bike */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Bike</Text>
          <Input
            label="Make"
            placeholder="e.g. Trek, Specialized"
            value={bikeMake}
            onChangeText={setBikeMake}
            containerStyle={styles.inputGap}
          />
          <Input
            label="Model"
            placeholder="e.g. Domane, Roubaix"
            value={bikeModel}
            onChangeText={setBikeModel}
          />
        </Card>

        {/* Services */}
        {services.length > 0 ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Services</Text>
            {services.map((svc) => {
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
                    color={selected ? colors.amber[500] : colors.slate[400]}
                  />
                  <View style={styles.serviceInfo}>
                    <Text style={styles.serviceName}>{svc.name}</Text>
                    {svc.description ? (
                      <Text style={styles.serviceDesc} numberOfLines={1}>
                        {svc.description}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.servicePrice}>
                    {formatCurrency(svc.price)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Card>
        ) : null}

        {/* Notes */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
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
          disabled={!bikeMake.trim() || !bikeModel.trim()}
          size="lg"
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.slate[50],
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
    color: colors.slate[800],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inputGap: {
    marginBottom: spacing[2],
  },
  selectedCustomer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.slate[50],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
  },
  selectedCustomerInfo: {
    flex: 1,
  },
  selectedCustomerName: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
  },
  meta: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  customerList: {
    borderWidth: 1,
    borderColor: colors.slate[200],
    borderRadius: borderRadius.lg,
    overflow: "hidden",
  },
  customerOption: {
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.slate[100],
  },
  customerOptionName: {
    ...fontSize.sm,
    fontWeight: "500",
    color: colors.slate[900],
  },
  customerOptionEmail: {
    ...fontSize.xs,
    color: colors.slate[500],
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
    color: colors.slate[900],
  },
  serviceDesc: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
  servicePrice: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[700],
    fontVariant: ["tabular-nums"],
  },
});
