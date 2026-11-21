import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, setCustomerShop, getCustomerShop } from "@/lib/api";
import {
  getCustomerProfile,
  saveContact,
  upsertBike,
  rememberShop,
  isContactComplete,
  type PastShop,
  type SavedBike,
  type CustomerProfile,
} from "@/lib/customer-profile";
import { setCustomerLoadPriority } from "@/lib/customer-load-priority";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";
import {
  ShopPicker,
  type SelectedShop,
} from "@/components/customer/ShopPicker";
import { formatCurrency } from "@/lib/format";

interface BookableService {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

export default function BookScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [bootstrapping, setBootstrapping] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setCustomerLoadPriority("book");
    }, [])
  );
  const [services, setServices] = useState<BookableService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string } | null>(null);

  const [selectedShop, setSelectedShop] = useState<SelectedShop | null>(null);
  const [pastShops, setPastShops] = useState<PastShop[]>([]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [editingContact, setEditingContact] = useState(true);
  const [savedBikes, setSavedBikes] = useState<SavedBike[]>([]);
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(null);
  const [addingNewBike, setAddingNewBike] = useState(false);
  const [bikePickerOpen, setBikePickerOpen] = useState(false);
  const [bikeMake, setBikeMake] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<
    "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE"
  >("DROP_OFF_AT_SHOP");
  const [collectionAddress, setCollectionAddress] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [smsConsent, setSmsConsent] = useState(false);
  const [servicesExpanded, setServicesExpanded] = useState(Platform.OS === "web");

  const applyProfile = useCallback((profile: CustomerProfile) => {
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setEmail(profile.email);
    setPhone(profile.phone);
    if (profile.address.trim()) {
      setCollectionAddress(profile.address);
    }
    setPastShops(profile.pastShops);
    setSavedBikes(profile.bikes);
    setEditingContact(!isContactComplete(profile));
    if (profile.bikes.length > 0) {
      const bike = profile.bikes[0];
      setSelectedBikeId(bike.id);
      setBikeMake(bike.make);
      setBikeModel(bike.model);
      setAddingNewBike(false);
    } else {
      setSelectedBikeId(null);
      setAddingNewBike(true);
      setBikeMake("");
      setBikeModel("");
    }
  }, []);

  const selectShop = useCallback(async (shop: SelectedShop) => {
    await setCustomerShop(shop.subdomain, shop.name);
    const profile = await rememberShop(shop.subdomain, shop.name);
    setPastShops(profile.pastShops);
    setSelectedShop(shop);
    setSelectedServiceIds([]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let profile = await getCustomerProfile();
        if (cancelled) return;

        const stored = await getCustomerShop();
        if (cancelled) return;
        if (stored?.subdomain) {
          profile = await rememberShop(
            stored.subdomain,
            stored.name ?? stored.subdomain
          );
        }
        if (cancelled) return;

        applyProfile(profile);

        if (stored?.subdomain) {
          await selectShop({
            subdomain: stored.subdomain,
            name: stored.name ?? stored.subdomain,
          });
        } else if (profile.pastShops[0]) {
          await selectShop({
            subdomain: profile.pastShops[0].subdomain,
            name: profile.pastShops[0].name,
          });
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyProfile, selectShop]);

  useEffect(() => {
    if (!selectedShop) {
      setServices([]);
      setServicesLoading(false);
      return;
    }

    let cancelled = false;
    setServicesLoading(true);
    api
      .get<BookableService[]>("/api/widget/services", { role: "customer" })
      .then(({ data }) => {
        if (!cancelled) setServices(data);
      })
      .catch(() => {
        if (!cancelled) setServices([]);
      })
      .finally(() => {
        if (!cancelled) setServicesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedShop?.subdomain]);

  const contactSummary = useMemo(() => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    const parts = [name, email.trim()].filter(Boolean);
    return parts.join(" · ");
  }, [firstName, lastName, email]);

  const contactComplete = isContactComplete({
    firstName,
    lastName,
    email,
    phone,
    address: "",
  });

  const shopDisplayName = selectedShop?.name ?? "your bike shop";

  const styles = useMemo(
    () =>
      StyleSheet.create({
        flex: {
          flex: 1,
        },
        container: {
          flex: 1,
          backgroundColor: theme.background,
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
          color: theme.textHeading,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        row: {
          flexDirection: "row",
          gap: spacing[3],
        },
        inputGap: {
          marginBottom: spacing[2],
        },
        consentRow: {
          flexDirection: "row",
          gap: spacing[3],
          alignItems: "flex-start",
        },
        consentText: {
          ...fontSize.sm,
          color: theme.textTertiary,
          flex: 1,
          lineHeight: 20,
        },
        consentStrong: {
          fontWeight: "700",
          color: theme.textTertiary,
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
          backgroundColor: theme.dark
            ? colors.amber[800] + "55"
            : colors.amber[100],
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[0.5],
        },
        selectedBadgeText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.dark ? colors.amber[400] : colors.amber[700],
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
          backgroundColor: theme.dark
            ? colors.amber[500] + "20"
            : colors.amber[50],
        },
        serviceInfo: {
          flex: 1,
        },
        serviceName: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.text,
        },
        serviceDesc: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        servicePrice: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.textTertiary,
          fontVariant: ["tabular-nums"],
        },
        deliveryOptions: {
          gap: spacing[2],
        },
        deliveryOption: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          paddingHorizontal: spacing[3],
          minHeight: 44,
          borderRadius: borderRadius.lg,
        },
        deliveryOptionActive: {
          backgroundColor: theme.dark
            ? colors.amber[500] + "20"
            : colors.amber[50],
        },
        deliveryLabel: {
          ...fontSize.sm,
          color: theme.text,
        },
        submitButton: {
          marginTop: spacing[2],
        },
        successContainer: {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing[8],
          gap: spacing[4],
          backgroundColor: theme.surface,
        },
        successTitle: {
          ...fontSize.xl,
          fontWeight: "700",
          color: theme.text,
        },
        successMessage: {
          ...fontSize.sm,
          color: theme.textTertiary,
          textAlign: "center",
          maxWidth: 300,
        },
        pickerButton: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 48,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.background,
        },
        pickerButtonText: {
          ...fontSize.sm,
          color: theme.text,
          flex: 1,
          marginRight: spacing[2],
        },
        summaryRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[3],
        },
        summaryText: {
          ...fontSize.sm,
          color: theme.text,
          flex: 1,
        },
        editLink: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.amber[600],
        },
        hint: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        modalList: {
          paddingHorizontal: spacing[2],
          paddingTop: spacing[2],
        },
        modalItem: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[3],
          borderRadius: borderRadius.lg,
          minHeight: 52,
        },
        modalItemSelected: {
          backgroundColor: theme.dark
            ? colors.amber[500] + "20"
            : colors.amber[50],
        },
        modalItemText: {
          flex: 1,
          gap: spacing[0.5],
        },
        modalItemTitle: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
        },
      }),
    [theme]
  );

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const selectBike = (bike: SavedBike) => {
    setSelectedBikeId(bike.id);
    setBikeMake(bike.make);
    setBikeModel(bike.model);
    setAddingNewBike(false);
    setBikePickerOpen(false);
  };

  const startAddNewBike = () => {
    setSelectedBikeId(null);
    setBikeMake("");
    setBikeModel("");
    setAddingNewBike(true);
    setBikePickerOpen(false);
  };

  const handleSubmit = async () => {
    if (!selectedShop) {
      Alert.alert("Required", "Please select a bike shop.");
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      Alert.alert("Required", "Please fill in all contact fields.");
      return;
    }
    if (!bikeMake.trim() || !bikeModel.trim()) {
      Alert.alert("Required", "Bike make and model are required.");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post<{ id: string }>(
        "/api/widget/book",
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          smsConsent,
          bikeMake: bikeMake.trim(),
          bikeModel: bikeModel.trim(),
          deliveryType,
          collectionAddress:
            deliveryType === "COLLECTION_SERVICE"
              ? collectionAddress.trim() || null
              : null,
          customerNotes: customerNotes.trim() || null,
          serviceIds: selectedServiceIds,
        },
        { role: "customer" }
      );

      const existingProfile = await getCustomerProfile();
      const contact = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: collectionAddress.trim() || existingProfile.address,
      };
      await saveContact(contact);
      const { profile: afterBike, bike } = await upsertBike(
        bikeMake,
        bikeModel,
        selectedBikeId
      );
      const afterShop = await rememberShop(
        selectedShop.subdomain,
        selectedShop.name
      );
      setPastShops(afterShop.pastShops);
      setSavedBikes(afterBike.bikes);
      setSelectedBikeId(bike.id);
      setAddingNewBike(false);
      setEditingContact(false);

      setSuccess({ id: data.id });
    } catch (e) {
      Alert.alert(
        "Error",
        e instanceof Error ? e.message : "Failed to submit booking."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (bootstrapping) return <LoadingScreen message="Loading booking options..." />;

  if (success) {
    return (
      <View style={styles.successContainer}>
        <Ionicons name="checkmark-circle" size={64} color={colors.emerald[500]} />
        <Text style={styles.successTitle}>Request submitted!</Text>
        <Text style={styles.successMessage}>
          We'll review your booking and email you once it's confirmed.
        </Text>
        <Button
          title="Track your repair status"
          onPress={() =>
            router.replace(`/(customer)/status/${success.id}`)
          }
          size="lg"
        />
      </View>
    );
  }

  const selectedBikeLabel =
    selectedBikeId && !addingNewBike
      ? savedBikes.find((b) => b.id === selectedBikeId)
      : null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Shop */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Bike Shop</Text>
          <ShopPicker
            pastShops={pastShops}
            selectedShop={selectedShop}
            onSelect={selectShop}
          />
        </Card>

        {/* Contact Info */}
        <Card style={styles.section}>
          <View style={styles.sectionToggle}>
            <Text style={styles.sectionTitle}>Your Info</Text>
            {!editingContact && contactComplete ? (
              <TouchableOpacity onPress={() => setEditingContact(true)}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {!editingContact && contactComplete ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>{contactSummary}</Text>
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <Input
                  label="First Name *"
                  value={firstName}
                  onChangeText={setFirstName}
                  containerStyle={{ flex: 1 }}
                />
                <Input
                  label="Last Name *"
                  value={lastName}
                  onChangeText={setLastName}
                  containerStyle={{ flex: 1 }}
                />
              </View>
              <Input
                label="Email *"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                containerStyle={styles.inputGap}
              />
              <Input
                label="Phone *"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              {contactComplete ? (
                <TouchableOpacity onPress={() => setEditingContact(false)}>
                  <Text style={styles.editLink}>Done</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </Card>

        {/* SMS Consent */}
        <Card style={styles.section}>
          <View style={styles.consentRow}>
            <Switch
              value={smsConsent}
              onValueChange={setSmsConsent}
              trackColor={{
                true: colors.amber[500],
                false: colors.slate[400],
              }}
              ios_backgroundColor={colors.slate[400]}
              thumbColor={colors.white}
            />
            <Text style={styles.consentText}>
              Optional: I agree to receive service-related SMS from{" "}
              <Text style={styles.consentStrong}>{shopDisplayName}</Text> about
              this repair, including status updates and questions about my bike.
              No marketing. Message frequency varies. Message & data rates may
              apply. Reply <Text style={styles.consentStrong}>STOP</Text> to opt
              out.
            </Text>
          </View>
        </Card>

        {/* Bike */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Bike</Text>
          {savedBikes.length > 0 ? (
            <>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setBikePickerOpen(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerButtonText} numberOfLines={1}>
                  {addingNewBike
                    ? "Add new bike"
                    : selectedBikeLabel
                      ? `${selectedBikeLabel.make} ${selectedBikeLabel.model}`
                      : "Select a bike"}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>
              {addingNewBike ? (
                <>
                  <Input
                    label="Make *"
                    placeholder="Trek, Specialized..."
                    value={bikeMake}
                    onChangeText={setBikeMake}
                    containerStyle={styles.inputGap}
                  />
                  <Input
                    label="Model *"
                    placeholder="Domane SL 6"
                    value={bikeModel}
                    onChangeText={setBikeModel}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <Input
                label="Make *"
                placeholder="Trek, Specialized..."
                value={bikeMake}
                onChangeText={setBikeMake}
                containerStyle={styles.inputGap}
              />
              <Input
                label="Model *"
                placeholder="Domane SL 6"
                value={bikeModel}
                onChangeText={setBikeModel}
              />
            </>
          )}
        </Card>

        {/* Services */}
        {selectedShop && servicesLoading ? (
          <Card style={styles.section}>
            <BikeLoader label="Loading services…" />
          </Card>
        ) : null}
        {selectedShop && !servicesLoading && services.length > 0 ? (
          <Card style={styles.section}>
            <TouchableOpacity
              onPress={() => setServicesExpanded((v) => !v)}
              style={styles.sectionToggle}
              activeOpacity={0.7}
            >
              <View style={styles.sectionToggleLeft}>
                <Text style={styles.sectionTitle}>Services (optional)</Text>
                {!servicesExpanded && selectedServiceIds.length > 0 ? (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>
                      {selectedServiceIds.length} selected
                    </Text>
                  </View>
                ) : null}
              </View>
              <Ionicons
                name={servicesExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
            {servicesExpanded
              ? services.map((svc) => {
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
                        color={selected ? colors.amber[500] : theme.textMuted}
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
                })
              : null}
          </Card>
        ) : null}

        {/* Delivery */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery</Text>
          <View style={styles.deliveryOptions}>
            <TouchableOpacity
              onPress={() => setDeliveryType("DROP_OFF_AT_SHOP")}
              style={[
                styles.deliveryOption,
                deliveryType === "DROP_OFF_AT_SHOP" && styles.deliveryOptionActive,
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
              <Text style={styles.deliveryLabel}>Drop-off at shop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setDeliveryType("COLLECTION_SERVICE")}
              style={[
                styles.deliveryOption,
                deliveryType === "COLLECTION_SERVICE" && styles.deliveryOptionActive,
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
              <Text style={styles.deliveryLabel}>Collection service</Text>
            </TouchableOpacity>
          </View>
          {deliveryType === "COLLECTION_SERVICE" ? (
            <Input
              label="Collection Address"
              placeholder="Street, city, postal code"
              value={collectionAddress}
              onChangeText={setCollectionAddress}
            />
          ) : null}
        </Card>

        {/* Notes */}
        <Card style={styles.section}>
          <Input
            label="Additional Info"
            placeholder="Anything else we should know?"
            value={customerNotes}
            onChangeText={setCustomerNotes}
            multiline
            numberOfLines={3}
            style={{ minHeight: 80, textAlignVertical: "top" }}
          />
        </Card>

        <Button
          title={submitting ? "Booking..." : "Book Repair"}
          onPress={handleSubmit}
          loading={submitting}
          size="lg"
          style={styles.submitButton}
          disabled={!selectedShop}
        />
      </ScrollView>

      {/* Bike picker modal */}
      <BottomSheetModal
        visible={bikePickerOpen}
        title="Select a bike"
        onClose={() => setBikePickerOpen(false)}
      >
        <ScrollView style={styles.modalList}>
          {savedBikes.map((bike) => {
            const selected =
              !addingNewBike && selectedBikeId === bike.id;
            return (
              <TouchableOpacity
                key={bike.id}
                style={[
                  styles.modalItem,
                  selected && styles.modalItemSelected,
                ]}
                onPress={() => selectBike(bike)}
              >
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? colors.amber[500] : theme.textMuted}
                />
                <View style={styles.modalItemText}>
                  <Text style={styles.modalItemTitle}>
                    {bike.make} {bike.model}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[
              styles.modalItem,
              addingNewBike && styles.modalItemSelected,
            ]}
            onPress={startAddNewBike}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={addingNewBike ? colors.amber[500] : theme.textMuted}
            />
            <View style={styles.modalItemText}>
              <Text style={styles.modalItemTitle}>Add new bike</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}
