import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  Modal,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  api,
  setCustomerShop,
  getCustomerShop,
  getDefaultCustomerShopSubdomain,
  getDefaultCustomerShopName,
} from "@/lib/api";
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
import {
  platformApi,
  PlatformApiError,
  type NearbyShop,
} from "@/lib/platform-api";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatCurrency } from "@/lib/format";

interface BookableService {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

type SelectedShop = { subdomain: string; name: string };

function BottomSheetModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const translateY = useRef(new Animated.Value(480)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(480);
    Animated.timing(translateY, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "flex-end",
        },
        sheet: {
          backgroundColor: theme.surface,
          borderTopLeftRadius: borderRadius.xl,
          borderTopRightRadius: borderRadius.xl,
          maxHeight: "80%",
          paddingBottom: spacing[8],
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[4],
          borderBottomWidth: 1,
          borderBottomColor: theme.surfaceBorder,
        },
        title: {
          ...fontSize.base,
          fontWeight: "700",
          color: theme.textHeading,
        },
      }),
    [theme]
  );

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function BookScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [services, setServices] = useState<BookableService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string } | null>(null);

  const [selectedShop, setSelectedShop] = useState<SelectedShop | null>(null);
  const [pastShops, setPastShops] = useState<PastShop[]>([]);
  const [shopPickerOpen, setShopPickerOpen] = useState(false);
  const [nearbyShops, setNearbyShops] = useState<NearbyShop[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyFetched, setNearbyFetched] = useState(false);

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
    setShopPickerOpen(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let profile = await getCustomerProfile();
        if (cancelled) return;

        // Seed known shops into history (env default + last selected).
        // Past shops were previously only written after a booking, so existing
        // customers would otherwise see an empty list.
        const envSub = getDefaultCustomerShopSubdomain();
        if (envSub) {
          profile = await rememberShop(envSub, getDefaultCustomerShopName());
        }
        if (cancelled) return;

        const stored = await getCustomerShop();
        if (cancelled) return;
        if (
          stored?.subdomain &&
          stored.subdomain !== envSub?.toLowerCase()
        ) {
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
        } else if (envSub) {
          await selectShop({
            subdomain: envSub,
            name: getDefaultCustomerShopName(),
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
  });

  const shopDisplayName =
    selectedShop?.name ?? getDefaultCustomerShopName();

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
          backgroundColor: colors.amber[50],
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
        pickerPlaceholder: {
          color: theme.textMuted,
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
          backgroundColor: colors.amber[50],
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
        modalItemSubtitle: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
        modalSectionLabel: {
          ...fontSize.xs,
          fontWeight: "700",
          color: theme.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          paddingHorizontal: spacing[3],
          paddingTop: spacing[3],
          paddingBottom: spacing[1],
        },
        nearbyButton: {
          marginHorizontal: spacing[3],
          marginTop: spacing[2],
        },
        nearbyStatus: {
          ...fontSize.sm,
          color: theme.textSecondary,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
        },
        emptyShopHint: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
          padding: spacing[4],
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

  const findNearbyShops = async () => {
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      let Location: typeof import("expo-location");
      try {
        Location = await import("expo-location");
      } catch {
        setNearbyError(
          "Location is unavailable in this build. Rebuild the app to enable nearby shops."
        );
        setNearbyFetched(true);
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setNearbyError("Location permission is required to find nearby shops.");
        setNearbyFetched(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { shops } = await platformApi.getNearbyShops(
        position.coords.latitude,
        position.coords.longitude
      );
      setNearbyShops(shops);
      setNearbyFetched(true);
    } catch (e) {
      const message =
        e instanceof PlatformApiError && (e.status === 404 || e.status >= 500)
          ? "Nearby shop search isn't available yet. Pick a shop you've used before, or try again later."
          : /ExpoLocation|native module/i.test(
                e instanceof Error ? e.message : ""
              )
            ? "Location is unavailable in this build. Rebuild the app to enable nearby shops."
            : e instanceof PlatformApiError
              ? e.message
              : e instanceof Error
                ? e.message
                : "Could not find nearby shops.";
      setNearbyError(message);
      setNearbyShops([]);
      setNearbyFetched(true);
    } finally {
      setNearbyLoading(false);
    }
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

      const contact = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
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
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => setShopPickerOpen(true)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.pickerButtonText,
                !selectedShop && styles.pickerPlaceholder,
              ]}
              numberOfLines={1}
            >
              {selectedShop
                ? selectedShop.name
                : "Select a bike shop"}
            </Text>
            <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
          {!selectedShop ? (
            <Text style={styles.hint}>
              Choose a shop you've used before, or find one nearby.
            </Text>
          ) : null}
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
              trackColor={{ true: colors.amber[500], false: theme.iconMuted }}
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
            <ActivityIndicator color={colors.amber[500]} />
            <Text style={styles.hint}>Loading services…</Text>
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

      {/* Shop picker modal */}
      <BottomSheetModal
        visible={shopPickerOpen}
        title="Select a shop"
        onClose={() => setShopPickerOpen(false)}
      >
        <ScrollView style={styles.modalList}>
          {pastShops.length > 0 ? (
            <>
              <Text style={styles.modalSectionLabel}>Your shops</Text>
              {pastShops.map((shop) => {
                const selected =
                  selectedShop?.subdomain === shop.subdomain;
                return (
                  <TouchableOpacity
                    key={shop.subdomain}
                    style={[
                      styles.modalItem,
                      selected && styles.modalItemSelected,
                    ]}
                    onPress={() =>
                      selectShop({
                        subdomain: shop.subdomain,
                        name: shop.name,
                      })
                    }
                  >
                    <Ionicons
                      name={selected ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={
                        selected ? colors.amber[500] : theme.textMuted
                      }
                    />
                    <View style={styles.modalItemText}>
                      <Text style={styles.modalItemTitle}>{shop.name}</Text>
                      <Text style={styles.modalItemSubtitle}>
                        {shop.subdomain}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <Text style={styles.emptyShopHint}>
              No past shops yet. Find one nearby to get started.
            </Text>
          )}

          <Text style={styles.modalSectionLabel}>Nearby</Text>
          <Button
            title={nearbyLoading ? "Finding…" : "Find nearby shops"}
            onPress={findNearbyShops}
            loading={nearbyLoading}
            variant="secondary"
            style={styles.nearbyButton}
          />
          {nearbyError ? (
            <Text style={styles.nearbyStatus}>{nearbyError}</Text>
          ) : null}
          {!nearbyError && nearbyFetched && nearbyShops.length === 0 ? (
            <Text style={styles.nearbyStatus}>
              No shops found nearby. Try again later.
            </Text>
          ) : null}
          {nearbyShops.map((shop) => {
            const selected =
              selectedShop?.subdomain === shop.subdomain;
            return (
              <TouchableOpacity
                key={shop.id}
                style={[
                  styles.modalItem,
                  selected && styles.modalItemSelected,
                ]}
                onPress={() =>
                  selectShop({
                    subdomain: shop.subdomain,
                    name: shop.name,
                  })
                }
              >
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? colors.amber[500] : theme.textMuted}
                />
                <View style={styles.modalItemText}>
                  <Text style={styles.modalItemTitle}>{shop.name}</Text>
                  <Text style={styles.modalItemSubtitle}>
                    {shop.address
                      ? `${shop.address} · ${shop.distanceKm.toFixed(1)} km`
                      : `${shop.distanceKm.toFixed(1)} km away`}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </BottomSheetModal>

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
