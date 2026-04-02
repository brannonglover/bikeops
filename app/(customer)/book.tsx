import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
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

const SHOP_NAME = process.env.EXPO_PUBLIC_SHOP_NAME ?? "Bike Shop";

export default function BookScreen() {
  const router = useRouter();
  const [services, setServices] = useState<BookableService[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string } | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [bikeMake, setBikeMake] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<"DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE">("DROP_OFF_AT_SHOP");
  const [collectionAddress, setCollectionAddress] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [smsConsent, setSmsConsent] = useState(false);

  useEffect(() => {
    api
      .get<BookableService[]>("/api/widget/services", { role: "customer" })
      .then(({ data }) => setServices(data))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  }, []);

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      Alert.alert("Required", "Please fill in all contact fields.");
      return;
    }
    if (!bikeMake.trim() || !bikeModel.trim()) {
      Alert.alert("Required", "Bike make and model are required.");
      return;
    }
    if (!smsConsent) {
      Alert.alert("Required", "Please agree to SMS notifications.");
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
          smsConsent: true,
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

  if (loading) return <LoadingScreen message="Loading booking options..." />;

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Contact Info */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Your Info</Text>
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
      </Card>

      {/* SMS Consent */}
      <Card style={styles.section}>
        <View style={styles.consentRow}>
          <Switch
            value={smsConsent}
            onValueChange={setSmsConsent}
            trackColor={{ true: colors.amber[500], false: colors.slate[300] }}
          />
          <Text style={styles.consentText}>
            I agree to receive SMS from {SHOP_NAME} about my repair. No
            marketing. Reply STOP to opt out.
          </Text>
        </View>
      </Card>

      {/* Bike */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Bike</Text>
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
      </Card>

      {/* Services */}
      {services.length > 0 ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Services (optional)</Text>
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
                  : colors.slate[400]
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
                  : colors.slate[400]
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
      />
    </ScrollView>
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
    color: colors.slate[700],
    flex: 1,
    lineHeight: 20,
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
  deliveryOptions: {
    gap: spacing[2],
  },
  deliveryOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: borderRadius.lg,
  },
  deliveryOptionActive: {
    backgroundColor: colors.amber[50],
  },
  deliveryLabel: {
    ...fontSize.sm,
    color: colors.slate[900],
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
    backgroundColor: colors.white,
  },
  successTitle: {
    ...fontSize.xl,
    fontWeight: "700",
    color: colors.slate[900],
  },
  successMessage: {
    ...fontSize.sm,
    color: colors.slate[600],
    textAlign: "center",
    maxWidth: 300,
  },
});
