import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer, type Bike, type Service, type DeliveryType } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { customerName, formatCurrency, formatDate } from "@/lib/format";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

export default function NewJobScreen() {
  const { theme } = useTheme();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [manualBikes, setManualBikes] = useState([{ make: "", model: "" }]);
  const [selectedCustomerBikeIds, setSelectedCustomerBikeIds] = useState<string[]>([]);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [notes, setNotes] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("DROP_OFF_AT_SHOP");
  const [dropOffDate, setDropOffDate] = useState<string | null>(null);
  const [pickupDate, setPickupDate] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<"dropOff" | "pickup" | null>(null);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

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

  const handleSelectCustomer = async (c: Customer) => {
    setCustomerSearch("");
    setCustomers([]);
    setSelectedCustomer(c);
    setLoadingCustomer(true);
    try {
      const { data } = await api.get<Customer>(`/api/customers/${c.id}`);

      if (!data.bikes || data.bikes.length === 0) {
        try {
          const { data: bikes } = await api.get<Bike[]>(
            `/api/customers/${c.id}/bikes`
          );
          if (Array.isArray(bikes) && bikes.length > 0) {
            data.bikes = bikes;
          }
        } catch {
          // Endpoint may not exist; bikes will remain empty
        }
      }

      setSelectedCustomer(data);
      if (data.bikes && data.bikes.length > 0) {
        setSelectedCustomerBikeIds(data.bikes.map((b) => b.id));
        setManualBikes([]);
      }
    } catch {
      // Keep the search-result version; bikes won't be available
    } finally {
      setLoadingCustomer(false);
    }
  };

  const handleClearCustomer = () => {
    setSelectedCustomer(null);
    setSelectedCustomerBikeIds([]);
    if (manualBikes.length === 0) {
      setManualBikes([{ make: "", model: "" }]);
    }
  };

  const toggleCustomerBike = (bikeId: string) => {
    setSelectedCustomerBikeIds((prev) =>
      prev.includes(bikeId) ? prev.filter((id) => id !== bikeId) : [...prev, bikeId]
    );
  };

  const updateManualBike = (index: number, field: "make" | "model", value: string) => {
    setManualBikes((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  };

  const addManualBike = () => setManualBikes((prev) => [...prev, { make: "", model: "" }]);

  const removeManualBike = (index: number) => {
    setManualBikes((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const hasValidBike =
    selectedCustomerBikeIds.length > 0 ||
    manualBikes.some((b) => b.make.trim());

  const calDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const blanks: null[] = Array(firstDay).fill(null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    return [...blanks, ...days];
  }, [calYear, calMonth]);

  const calSelectedDay = useMemo(() => {
    if (!showDatePicker) return null;
    const raw = showDatePicker === "dropOff" ? dropOffDate : pickupDate;
    if (!raw) return null;
    const d = new Date(raw);
    if (d.getMonth() === calMonth && d.getFullYear() === calYear) return d.getDate();
    return null;
  }, [showDatePicker, dropOffDate, pickupDate, calMonth, calYear]);

  const openDatePicker = useCallback(
    (field: "dropOff" | "pickup") => {
      const existing = field === "dropOff" ? dropOffDate : pickupDate;
      const d = existing ? new Date(existing) : new Date();
      setCalMonth(d.getMonth());
      setCalYear(d.getFullYear());
      setShowDatePicker(field);
    },
    [dropOffDate, pickupDate]
  );

  const handleSelectDay = useCallback(
    (day: number) => {
      if (!showDatePicker) return;
      const iso = new Date(calYear, calMonth, day, 12).toISOString();
      if (showDatePicker === "dropOff") setDropOffDate(iso);
      else setPickupDate(iso);
      setShowDatePicker(null);
    },
    [showDatePicker, calYear, calMonth]
  );

  const clearDate = useCallback(
    (field: "dropOff" | "pickup") => {
      if (field === "dropOff") setDropOffDate(null);
      else setPickupDate(null);
      setShowDatePicker(null);
    },
    []
  );

  const handleSubmit = async () => {
    if (!selectedCustomer && customerSearch.trim()) {
      Alert.alert(
        "Select Customer",
        "Tap a customer from the search results to attach them to this job, or clear the customer field to create a walk-in job."
      );
      return;
    }

    const customerBikes = (selectedCustomer?.bikes ?? [])
      .filter((b) => selectedCustomerBikeIds.includes(b.id))
      .map((b) => ({ make: b.make, model: b.model ?? null, bikeId: b.id }));
    const validManual = manualBikes
      .filter((b) => b.make.trim())
      .map((b) => ({ make: b.make.trim(), model: b.model.trim() || null }));
    const allBikes = [...customerBikes, ...validManual];

    if (allBikes.length === 0) {
      Alert.alert("Required", "At least one bike is required.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/jobs", {
        bikeMake: allBikes[0].make,
        bikeModel: allBikes[0].model ?? null,
        customerId: selectedCustomer?.id ?? null,
        notes: notes.trim() || null,
        serviceIds: selectedServiceIds,
        bikes: allBikes,
        deliveryType,
        dropOffDate: dropOffDate ?? null,
        pickupDate: pickupDate ?? null,
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
          contentContainerStyle={[
            styles.content,
            layout.isTablet && styles.tabletContent,
          ]}
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
                  {loadingCustomer ? (
                    <Text style={[styles.meta, { color: theme.textTertiary }]}>
                      Loading bikes…
                    </Text>
                  ) : selectedCustomer.bikes?.length ? (
                    <Text style={[styles.meta, { color: theme.textSecondary }]}>
                      {selectedCustomer.bikes.length}{" "}
                      {selectedCustomer.bikes.length === 1 ? "bike" : "bikes"} on file
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={handleClearCustomer}>
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
                {customerSearch.trim() ? (
                  <Text style={[styles.customerSearchHint, { color: theme.textSecondary }]}>
                    Select a result below to attach this customer.
                  </Text>
                ) : null}
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
                        onPress={() => handleSelectCustomer(c)}
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
                ) : customerSearch.trim() ? (
                  <Text style={[styles.customerSearchHint, { color: theme.textMuted }]}>
                    No matching customer found. Clear this field to continue as a walk-in job.
                  </Text>
                ) : null}
              </>
            )}
          </Card>

          {/* Bikes */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
              Bikes
            </Text>

            {selectedCustomer?.bikes && selectedCustomer.bikes.length > 0 ? (
              <>
                <Text style={[styles.subsectionLabel, { color: theme.textSecondary }]}>
                  {customerName(selectedCustomer)}{"'"}s bikes
                </Text>
                {selectedCustomer.bikes.map((bike) => {
                  const selected = selectedCustomerBikeIds.includes(bike.id);
                  return (
                    <TouchableOpacity
                      key={bike.id}
                      onPress={() => toggleCustomerBike(bike.id)}
                      style={[
                        styles.customerBikeOption,
                        selected && {
                          backgroundColor: theme.dark
                            ? "rgba(245, 158, 11, 0.15)"
                            : colors.amber[50],
                        },
                      ]}
                    >
                      <Ionicons
                        name={selected ? "checkbox" : "square-outline"}
                        size={20}
                        color={selected ? colors.amber[500] : theme.iconMuted}
                      />
                      <Ionicons name="bicycle" size={18} color={theme.icon} />
                      <View style={styles.customerBikeInfo}>
                        <Text style={[styles.customerBikeName, { color: theme.text }]}>
                          {[bike.make, bike.model].filter(Boolean).join(" ")}
                        </Text>
                        {bike.nickname ? (
                          <Text
                            style={[styles.customerBikeNickname, { color: theme.textSecondary }]}
                          >
                            {bike.nickname}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : null}

            {loadingCustomer ? (
              <Text style={[styles.loadingBikesText, { color: theme.textTertiary }]}>
                Loading customer bikes…
              </Text>
            ) : null}

            {manualBikes.map((bike, index) => {
              const hasCustomerBikes = (selectedCustomer?.bikes?.length ?? 0) > 0;
              return (
                <View
                  key={`manual-${index}`}
                  style={[
                    styles.bikeEntry,
                    (index > 0 || hasCustomerBikes) && {
                      borderTopWidth: 1,
                      borderTopColor: theme.surfaceBorderSubtle,
                    },
                  ]}
                >
                  {(manualBikes.length > 1 || hasCustomerBikes) && (
                    <View style={styles.bikeHeader}>
                      <Text style={[styles.bikeLabel, { color: theme.textSecondary }]}>
                        {hasCustomerBikes
                          ? manualBikes.length > 1
                            ? `New Bike ${index + 1}`
                            : "New Bike"
                          : `Bike ${index + 1}`}
                      </Text>
                      <TouchableOpacity
                        onPress={() => removeManualBike(index)}
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
                    onChangeText={(v) => updateManualBike(index, "make", v)}
                    containerStyle={styles.inputGap}
                  />
                  <Input
                    label="Model (optional)"
                    placeholder="e.g. Domane, Roubaix"
                    value={bike.model}
                    onChangeText={(v) => updateManualBike(index, "model", v)}
                  />
                </View>
              );
            })}

            <TouchableOpacity onPress={addManualBike} style={styles.addBikeBtn}>
              <Ionicons name="add-circle-outline" size={20} color={colors.amber[600]} />
              <Text style={styles.addBikeText}>
                {(selectedCustomer?.bikes?.length ?? 0) > 0 ? "Add New Bike" : "Add Bike"}
              </Text>
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
                              selected && {
                                backgroundColor: theme.dark
                                  ? "rgba(245, 158, 11, 0.15)"
                                  : colors.amber[50],
                              },
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

          {/* Details: Delivery & Dates */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textHeading }]}>
              Details
            </Text>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
              Delivery
            </Text>
            <View style={styles.deliveryOptions}>
              <TouchableOpacity
                onPress={() => setDeliveryType("DROP_OFF_AT_SHOP")}
                style={[
                  styles.deliveryOption,
                  deliveryType === "DROP_OFF_AT_SHOP" && {
                    backgroundColor: theme.dark
                      ? `${colors.amber[500]}22`
                      : colors.amber[50],
                  },
                ]}
              >
                <Ionicons
                  name={
                    deliveryType === "DROP_OFF_AT_SHOP"
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={20}
                  color={
                    deliveryType === "DROP_OFF_AT_SHOP"
                      ? colors.amber[500]
                      : theme.textMuted
                  }
                />
                <Text style={[styles.deliveryLabel, { color: theme.text }]}>
                  Drop-off at shop
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDeliveryType("COLLECTION_SERVICE")}
                style={[
                  styles.deliveryOption,
                  deliveryType === "COLLECTION_SERVICE" && {
                    backgroundColor: theme.dark
                      ? `${colors.amber[500]}22`
                      : colors.amber[50],
                  },
                ]}
              >
                <Ionicons
                  name={
                    deliveryType === "COLLECTION_SERVICE"
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={20}
                  color={
                    deliveryType === "COLLECTION_SERVICE"
                      ? colors.amber[500]
                      : theme.textMuted
                  }
                />
                <Text style={[styles.deliveryLabel, { color: theme.text }]}>
                  Collection service
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.dateRow}
              onPress={() => openDatePicker("dropOff")}
              activeOpacity={0.6}
            >
              <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
                Drop-off
              </Text>
              <View style={styles.dateValue}>
                <Text
                  style={[
                    styles.dateText,
                    { color: dropOffDate ? theme.text : theme.textMuted },
                  ]}
                >
                  {dropOffDate ? formatDate(dropOffDate) : "Set date"}
                </Text>
                <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dateRow}
              onPress={() => openDatePicker("pickup")}
              activeOpacity={0.6}
            >
              <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
                Pickup
              </Text>
              <View style={styles.dateValue}>
                <Text
                  style={[
                    styles.dateText,
                    { color: pickupDate ? theme.text : theme.textMuted },
                  ]}
                >
                  {pickupDate ? formatDate(pickupDate) : "Set date"}
                </Text>
                <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
              </View>
            </TouchableOpacity>
          </Card>

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

      {/* Date picker modal */}
      <Modal
        visible={showDatePicker !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowDatePicker(null)}
      >
        <Pressable
          style={datePickerStyles.backdrop}
          onPress={() => setShowDatePicker(null)}
        >
          <Pressable
            style={[datePickerStyles.sheet, { backgroundColor: theme.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[datePickerStyles.title, { color: theme.textHeading }]}>
              {showDatePicker === "dropOff" ? "Drop-off Date" : "Pickup Date"}
            </Text>

            <View style={datePickerStyles.navRow}>
              <TouchableOpacity
                onPress={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                  else setCalMonth(calMonth - 1);
                }}
                style={datePickerStyles.navButton}
              >
                <Ionicons name="chevron-back" size={20} color={theme.text} />
              </TouchableOpacity>
              <Text style={[datePickerStyles.navLabel, { color: theme.text }]}>
                {new Date(calYear, calMonth).toLocaleString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                  else setCalMonth(calMonth + 1);
                }}
                style={datePickerStyles.navButton}
              >
                <Ionicons name="chevron-forward" size={20} color={theme.text} />
              </TouchableOpacity>
            </View>

            <View style={datePickerStyles.weekRow}>
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <Text
                  key={d}
                  style={[datePickerStyles.weekDay, { color: theme.textMuted }]}
                >
                  {d}
                </Text>
              ))}
            </View>

            <View style={datePickerStyles.grid}>
              {calDays.map((day, i) => {
                if (day === null)
                  return <View key={`b${i}`} style={datePickerStyles.cell} />;
                const isSelected = day === calSelectedDay;
                const isToday =
                  day === new Date().getDate() &&
                  calMonth === new Date().getMonth() &&
                  calYear === new Date().getFullYear();
                return (
                  <TouchableOpacity
                    key={day}
                    onPress={() => handleSelectDay(day)}
                    style={datePickerStyles.cell}
                    activeOpacity={0.6}
                  >
                    <View
                      style={[
                        datePickerStyles.dayCircle,
                        isSelected && { backgroundColor: colors.amber[500] },
                        !isSelected &&
                          isToday && {
                            borderWidth: 1,
                            borderColor: colors.amber[400],
                          },
                      ]}
                    >
                      <Text
                        style={[
                          datePickerStyles.dayText,
                          { color: theme.text },
                          isSelected && { color: colors.white, fontWeight: "700" },
                        ]}
                      >
                        {day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={datePickerStyles.actions}>
              {((showDatePicker === "dropOff" && dropOffDate) ||
                (showDatePicker === "pickup" && pickupDate)) ? (
                <TouchableOpacity
                  onPress={() => clearDate(showDatePicker!)}
                  style={datePickerStyles.clearButton}
                >
                  <Text style={[datePickerStyles.clearText, { color: colors.red[500] }]}>
                    Clear
                  </Text>
                </TouchableOpacity>
              ) : (
                <View />
              )}
              <Button
                title="Cancel"
                onPress={() => setShowDatePicker(null)}
                variant="ghost"
                size="md"
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  tabletContent: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: spacing[6],
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
  subsectionLabel: {
    ...fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  customerBikeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
  },
  customerBikeInfo: {
    flex: 1,
  },
  customerBikeName: {
    ...fontSize.sm,
    fontWeight: "500",
  },
  customerBikeNickname: {
    ...fontSize.xs,
  },
  loadingBikesText: {
    ...fontSize.sm,
    paddingVertical: spacing[2],
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
  customerSearchHint: {
    ...fontSize.xs,
    marginTop: -spacing[2],
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
  serviceOptionSelected: {},
  detailLabel: {
    ...fontSize.sm,
  },
  deliveryOptions: {
    gap: spacing[1],
  },
  deliveryOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    minHeight: 44,
    borderRadius: borderRadius.lg,
  },
  deliveryLabel: {
    ...fontSize.sm,
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dateValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
  },
  dateText: {
    ...fontSize.sm,
    fontWeight: "500",
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

const datePickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[4],
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    gap: spacing[2],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    ...fontSize.lg,
    fontWeight: "700",
    textAlign: "center",
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navButton: {
    padding: spacing[2],
  },
  navLabel: {
    ...fontSize.base,
    fontWeight: "600",
  },
  weekRow: {
    flexDirection: "row",
  },
  weekDay: {
    width: `${100 / 7}%`,
    textAlign: "center",
    ...fontSize.xs,
    fontWeight: "600",
    paddingVertical: spacing[1],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  dayText: {
    ...fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing[1],
  },
  clearButton: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1],
  },
  clearText: {
    ...fontSize.sm,
    fontWeight: "600",
  },
});
