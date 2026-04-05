import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  StyleSheet,
  Image,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Customer } from "@/lib/types";
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
              onPress={() => updateCustomer.mutate()}
              loading={updateCustomer.isPending}
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
                    {customer.phone}
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
          </>
        )}
      </ScrollView>
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
});
