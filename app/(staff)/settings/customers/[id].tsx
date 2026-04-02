import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  StyleSheet,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { customerName } from "@/lib/format";

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
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
    isRefetching,
  } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data } = await api.get<Customer>(`/api/customers/${id}`);
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
                color={colors.slate[600]}
              />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {editing ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Edit Customer</Text>
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
              value={phone}
              onChangeText={setPhone}
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
              onPress={() => updateCustomer.mutate()}
              loading={updateCustomer.isPending}
              disabled={!firstName.trim()}
            />
          </Card>
        ) : (
          <>
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Contact</Text>
              {customer.email ? (
                <View style={styles.infoRow}>
                  <Ionicons name="mail-outline" size={16} color={colors.slate[400]} />
                  <Text style={styles.infoText}>{customer.email}</Text>
                </View>
              ) : null}
              {customer.phone ? (
                <View style={styles.infoRow}>
                  <Ionicons name="call-outline" size={16} color={colors.slate[400]} />
                  <Text style={styles.infoText}>{customer.phone}</Text>
                </View>
              ) : null}
              {customer.address ? (
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={16} color={colors.slate[400]} />
                  <Text style={styles.infoText}>{customer.address}</Text>
                </View>
              ) : null}
              {customer.notes ? (
                <View style={styles.infoRow}>
                  <Ionicons name="document-text-outline" size={16} color={colors.slate[400]} />
                  <Text style={styles.infoText}>{customer.notes}</Text>
                </View>
              ) : null}
            </Card>

            {customer.bikes && customer.bikes.length > 0 ? (
              <Card style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Bikes ({customer.bikes.length})
                </Text>
                {customer.bikes.map((bike) => (
                  <View key={bike.id} style={styles.bikeRow}>
                    {bike.imageUrl ? (
                      <Image
                        source={{ uri: bike.imageUrl }}
                        style={styles.bikeImage}
                      />
                    ) : (
                      <View style={styles.bikePlaceholder}>
                        <Ionicons name="bicycle" size={20} color={colors.slate[300]} />
                      </View>
                    )}
                    <View>
                      <Text style={styles.bikeName}>
                        {bike.make} {bike.model}
                      </Text>
                      {bike.nickname ? (
                        <Text style={styles.bikeNickname}>{bike.nickname}</Text>
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
          </>
        )}
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
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  infoText: {
    ...fontSize.sm,
    color: colors.slate[700],
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
    backgroundColor: colors.slate[100],
  },
  bikePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.slate[100],
    justifyContent: "center",
    alignItems: "center",
  },
  bikeName: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
  },
  bikeNickname: {
    ...fontSize.xs,
    color: colors.slate[500],
  },
});
