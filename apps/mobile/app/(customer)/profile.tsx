import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  getCustomerProfile,
  saveContact,
  saveImageUrl,
  upsertBike,
  deleteBike,
  syncProfileFromServer,
  isContactComplete,
  type SavedBike,
} from "@/lib/customer-profile";
import {
  loadCustomerMeData,
  loadCustomerBikesFromJobs,
  updateCustomerMe,
  createCustomerBike,
  updateCustomerBike,
  deleteCustomerBike,
  uploadCustomerPhoto,
  type ProfileBikeSource,
} from "@/lib/customer-api";
import {
  customerMeQueryKey,
  setCustomerLoadPriority,
  type CustomerMeQueryData,
} from "@/lib/customer-load-priority";
import { isCustomerAuthenticated, resolveCustomerUrl, peekCustomerSessionCookie } from "@/lib/api";
import { formatPhoneNumber, unformatPhoneNumber } from "@/lib/format";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SectionLoader } from "@/components/ui/SectionLoader";
import { ImageViewer } from "@/components/ui/ImageViewer";

type ProfileBike = SavedBike & {
  nickname?: string | null;
  imageUrl?: string | null;
};

function bikeDisplayTitle(bike: ProfileBike): string {
  const nickname = bike.nickname?.trim();
  if (nickname) return nickname;
  return [bike.make, bike.model].filter(Boolean).join(" ") || "Bike";
}

function bikeDisplaySubtitle(bike: ProfileBike): string | null {
  const nickname = bike.nickname?.trim();
  if (!nickname) return null;
  const makeModel = [bike.make, bike.model].filter(Boolean).join(" ");
  return makeModel || null;
}

export default function CustomerProfileScreen() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [bikesLoading, setBikesLoading] = useState(false);
  /** True when we have a shop session and loaded CRM data from the API. */
  const [synced, setSynced] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingBike, setSavingBike] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraftReady, setContactDraftReady] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(false);

  const [bikes, setBikes] = useState<ProfileBike[]>([]);
  const [editingBikeId, setEditingBikeId] = useState<string | null>(null);
  const [addingBike, setAddingBike] = useState(false);
  const [bikeMake, setBikeMake] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [bikeNickname, setBikeNickname] = useState("");

  const mapRemoteBikes = useCallback(
    (remoteBikes: ProfileBikeSource[]): ProfileBike[] =>
      remoteBikes.map((b) => ({
        id: b.id,
        make: b.make,
        model: b.model,
        nickname: b.nickname,
        imageUrl: b.imageUrl,
      })),
    []
  );

  const applyLocal = useCallback(
    (profile: Awaited<ReturnType<typeof getCustomerProfile>>) => {
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
      setEmail(profile.email);
      setPhone(profile.phone);
      setAddress(profile.address);
      setImageUrl(profile.imageUrl);
      setBikes(profile.bikes);
      setEditingContact(!isContactComplete(profile));
      setContactDraftReady(false);
    },
    []
  );

  const applyRemoteContact = useCallback(
    async (
      customer: {
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        imageUrl?: string | null;
      },
      remoteBikes: ProfileBikeSource[],
      fallback: Awaited<ReturnType<typeof getCustomerProfile>>
    ) => {
      const cached = await syncProfileFromServer({
        firstName: customer.firstName ?? fallback.firstName,
        lastName: customer.lastName ?? fallback.lastName,
        email: customer.email ?? fallback.email,
        phone: customer.phone ?? fallback.phone,
        address: customer.address ?? fallback.address,
        imageUrl: customer.imageUrl ?? fallback.imageUrl,
        bikes: remoteBikes,
      });
      applyLocal(cached);
      setBikes(mapRemoteBikes(remoteBikes));
      setImageUrl(customer.imageUrl ?? cached.imageUrl);
      setAddress(customer.address ?? cached.address);
    },
    [applyLocal, mapRemoteBikes]
  );

  const loadProfile = useCallback(async () => {
    const local = await getCustomerProfile();
    applyLocal(local);
    setLoading(false);

    // Prefer local session signals so Profile doesn't wait on /api/chat/me
    // when Home already established auth. Soft-check in the background.
    const cookie = await peekCustomerSessionCookie();
    const authed = !!cookie || (await isCustomerAuthenticated());
    if (!authed) {
      setSynced(false);
      setBikesLoading(false);
      return;
    }

    setBikesLoading(true);
    try {
      // Stage 1: contact + CRM bikes from /me (use Home prefetch when warm)
      const prefetched = queryClient.getQueryData<CustomerMeQueryData>(
        customerMeQueryKey
      );
      const me: CustomerMeQueryData =
        prefetched ??
        (await queryClient.fetchQuery({
          queryKey: customerMeQueryKey,
          queryFn: loadCustomerMeData,
        }));
      setSynced(me.synced);

      if (me.customer) {
        await applyRemoteContact(me.customer, me.bikes, local);
      } else if (me.bikes.length > 0) {
        setBikes(mapRemoteBikes(me.bikes));
      }

      // Stage 2: merge repair-history bikes (slower) — bikes only so we
      // don't clobber contact edits that started after stage 1 painted.
      const merged = await loadCustomerBikesFromJobs(me);
      setBikes(mapRemoteBikes(merged.bikes));

      if (!me.customer && merged.customer) {
        await applyRemoteContact(merged.customer, merged.bikes, local);
      } else {
        await syncProfileFromServer({
          firstName: (me.customer ?? merged.customer)?.firstName ?? local.firstName,
          lastName: (me.customer ?? merged.customer)?.lastName ?? local.lastName,
          email: (me.customer ?? merged.customer)?.email ?? local.email,
          phone: (me.customer ?? merged.customer)?.phone ?? local.phone,
          address: (me.customer ?? merged.customer)?.address ?? local.address,
          imageUrl:
            (me.customer ?? merged.customer)?.imageUrl ?? local.imageUrl,
          bikes: merged.bikes,
        });
      }
    } catch {
      setSynced(false);
    } finally {
      setBikesLoading(false);
    }
  }, [applyLocal, applyRemoteContact, mapRemoteBikes, queryClient]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      setCustomerLoadPriority("profile");
      void loadProfile();
    }, [loadProfile])
  );

  const contactComplete = isContactComplete({
    firstName,
    lastName,
    email,
    phone,
    address,
  });

  const displayImageUrl = imageUrl ? resolveCustomerUrl(imageUrl) : null;

  const contactSummary = useMemo(() => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    return [
      { icon: "person-outline" as const, text: name },
      { icon: "mail-outline" as const, text: email.trim() },
      {
        icon: "call-outline" as const,
        text: phone.trim() ? formatPhoneNumber(phone) : "",
      },
      { icon: "location-outline" as const, text: address.trim() },
    ].filter((row) => row.text);
  }, [firstName, lastName, email, phone, address]);

  const beginEditContact = () => {
    setContactDraftReady(true);
    setEditingContact(true);
  };

  const cancelEditContact = async () => {
    await loadProfile();
  };

  const resetBikeForm = () => {
    setEditingBikeId(null);
    setAddingBike(false);
    setBikeMake("");
    setBikeModel("");
    setBikeNickname("");
  };

  const startAddingBike = () => {
    setEditingBikeId(null);
    setBikeMake("");
    setBikeModel("");
    setBikeNickname("");
    setAddingBike(true);
  };

  const startEditingBike = (bike: ProfileBike) => {
    setAddingBike(false);
    setEditingBikeId(bike.id);
    setBikeMake(bike.make);
    setBikeModel(bike.model);
    setBikeNickname(bike.nickname ?? "");
  };

  const handleSaveContact = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      Alert.alert("Required", "Please fill in all contact fields.");
      return;
    }

    setSavingContact(true);
    try {
      if (synced) {
        const remote = await updateCustomerMe({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim() || null,
        });
        await syncProfileFromServer({
          firstName: remote.firstName,
          lastName: remote.lastName,
          email: remote.email,
          phone: remote.phone,
          address: remote.address,
          imageUrl: remote.imageUrl,
          bikes: remote.bikes ?? [],
        });
        setFirstName(remote.firstName);
        setLastName(remote.lastName ?? "");
        setEmail(remote.email ?? "");
        setPhone(remote.phone ?? "");
        setAddress(remote.address ?? "");
        setImageUrl(remote.imageUrl);
      } else {
        const profile = await saveContact({
          firstName,
          lastName,
          email,
          phone,
          address,
        });
        setFirstName(profile.firstName);
        setLastName(profile.lastName);
        setEmail(profile.email);
        setPhone(profile.phone);
        setAddress(profile.address);
      }
      setEditingContact(false);
      setContactDraftReady(false);
    } catch (e) {
      Alert.alert(
        "Error",
        e instanceof Error ? e.message : "Failed to save your info."
      );
    } finally {
      setSavingContact(false);
    }
  };

  const pickAndUploadPhoto = async (source: "camera" | "library") => {
    if (uploadingPhoto) return;

    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Camera access needed",
          "Allow camera access in Settings to take a profile photo."
        );
        return;
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Photo library access needed",
          "Allow photo library access in Settings to choose a profile photo."
        );
        return;
      }
    }

    const launch =
      source === "camera"
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;
    const result = await launch({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploadingPhoto(true);
    const previousUrl = imageUrl;
    setImageUrl(asset.uri);

    try {
      if (synced) {
        const uploadedUrl = await uploadCustomerPhoto(asset);
        const remote = await updateCustomerMe({ imageUrl: uploadedUrl });
        await saveImageUrl(remote.imageUrl);
        setImageUrl(remote.imageUrl);
      } else {
        await saveImageUrl(asset.uri);
        setImageUrl(asset.uri);
      }
    } catch (e) {
      setImageUrl(previousUrl);
      Alert.alert(
        "Upload failed",
        e instanceof Error ? e.message : "Could not update profile photo"
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = () => {
    Alert.alert("Remove Photo", "Remove your profile photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const previousUrl = imageUrl;
          setImageUrl(null);
          try {
            if (synced) {
              const remote = await updateCustomerMe({ imageUrl: null });
              await saveImageUrl(remote.imageUrl);
              setImageUrl(remote.imageUrl);
            } else {
              await saveImageUrl(null);
            }
          } catch (e) {
            setImageUrl(previousUrl);
            Alert.alert(
              "Error",
              e instanceof Error ? e.message : "Failed to remove photo."
            );
          }
        },
      },
    ]);
  };

  const showPhotoActions = () => {
    if (uploadingPhoto) return;

    const options: {
      text: string;
      onPress?: () => void;
      style?: "cancel" | "destructive" | "default";
    }[] = [];

    if (displayImageUrl) {
      options.push({
        text: "View Photo",
        onPress: () => setViewingPhoto(true),
      });
    }

    options.push(
      {
        text: "Take Photo",
        onPress: () => {
          void pickAndUploadPhoto("camera");
        },
      },
      {
        text: "Choose from Library",
        onPress: () => {
          void pickAndUploadPhoto("library");
        },
      }
    );

    if (displayImageUrl) {
      options.push({
        text: "Remove Photo",
        style: "destructive",
        onPress: removePhoto,
      });
    }

    options.push({ text: "Cancel", style: "cancel" });

    Alert.alert(
      displayImageUrl ? "Profile Photo" : "Add Profile Photo",
      undefined,
      options
    );
  };

  const handleSaveBike = async () => {
    if (!bikeMake.trim() || !bikeModel.trim()) {
      Alert.alert("Required", "Bike make and model are required.");
      return;
    }

    const editingExistingCrmBike =
      !!editingBikeId && !editingBikeId.startsWith("job");

    setSavingBike(true);
    try {
      if (synced) {
        let nextBikes: ProfileBike[];
        if (editingExistingCrmBike) {
          const bike = await updateCustomerBike(editingBikeId!, {
            make: bikeMake.trim(),
            model: bikeModel.trim(),
            nickname: bikeNickname.trim() || null,
          });
          nextBikes = bikes.map((b) =>
            b.id === bike.id
              ? {
                  id: bike.id,
                  make: bike.make,
                  model: bike.model ?? "",
                  nickname: bike.nickname,
                  imageUrl: bike.imageUrl,
                }
              : b
          );
        } else {
          const bike = await createCustomerBike({
            make: bikeMake.trim(),
            model: bikeModel.trim(),
            nickname: bikeNickname.trim() || null,
          });
          const created: ProfileBike = {
            id: bike.id,
            make: bike.make,
            model: bike.model ?? "",
            nickname: bike.nickname,
            imageUrl: bike.imageUrl,
          };
          if (editingBikeId) {
            nextBikes = bikes.map((b) =>
              b.id === editingBikeId ? created : b
            );
          } else {
            nextBikes = [...bikes, created];
          }
        }
        setBikes(nextBikes);
        await syncProfileFromServer({
          firstName,
          lastName,
          email,
          phone,
          imageUrl,
          bikes: nextBikes,
        });
      } else {
        const { profile } = await upsertBike(
          bikeMake,
          bikeModel,
          editingExistingCrmBike ? editingBikeId : null
        );
        setBikes(profile.bikes);
      }
      resetBikeForm();
    } catch (e) {
      Alert.alert(
        "Error",
        e instanceof Error ? e.message : "Failed to save bike."
      );
    } finally {
      setSavingBike(false);
    }
  };

  const handleDeleteBike = (bike: ProfileBike) => {
    Alert.alert(
      "Remove Bike",
      `Remove ${[bike.make, bike.model].filter(Boolean).join(" ")} from your profile?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const isCrmBike = !bike.id.startsWith("job");
              if (synced && isCrmBike) {
                await deleteCustomerBike(bike.id);
              }
              if (isCrmBike) {
                const profile = await deleteBike(bike.id);
                setBikes(profile.bikes);
              } else {
                const next = bikes.filter((b) => b.id !== bike.id);
                setBikes(next);
                await syncProfileFromServer({
                  firstName,
                  lastName,
                  email,
                  phone,
                  imageUrl,
                  bikes: next,
                });
              }
              if (editingBikeId === bike.id) resetBikeForm();
            } catch (e) {
              Alert.alert(
                "Error",
                e instanceof Error ? e.message : "Failed to remove bike."
              );
            }
          },
        },
      ]
    );
  };

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
        sectionHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
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
        editLink: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.amber[600],
        },
        infoRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[2],
        },
        infoText: {
          ...fontSize.sm,
          color: theme.text,
          flex: 1,
        },
        emptyText: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        bikesLoadingRow: {
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: spacing[2],
        },
        avatarBlock: {
          alignItems: "center",
          gap: spacing[2],
          paddingVertical: spacing[2],
        },
        avatarButton: {
          width: 104,
          height: 104,
          borderRadius: 52,
          overflow: "hidden",
          backgroundColor: theme.subtleBg,
          borderWidth: 2,
          borderColor: theme.surfaceBorder,
          justifyContent: "center",
          alignItems: "center",
        },
        avatarImage: {
          width: "100%",
          height: "100%",
        },
        avatarHint: {
          ...fontSize.sm,
          fontWeight: "600",
          color: colors.amber[600],
        },
        bikeBlock: {
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.background,
          padding: spacing[3],
          gap: spacing[2],
        },
        bikeBlockEditing: {
          borderColor: colors.amber[400],
          backgroundColor: theme.dark
            ? colors.amber[800] + "55"
            : colors.amber[50],
        },
        bikeRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
          minHeight: 44,
        },
        bikeIcon: {
          width: 44,
          height: 44,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.dark
            ? colors.blue[500] + "22"
            : colors.blue[50],
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
        },
        bikeThumb: {
          width: 44,
          height: 44,
        },
        bikeInfo: {
          flex: 1,
          gap: 2,
        },
        bikeTitle: {
          ...fontSize.base,
          fontWeight: "700",
          color: theme.text,
        },
        bikeSubtitle: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        bikeActions: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
        },
        bikeEditForm: {
          gap: spacing[2],
        },
        bikeEditActions: {
          flexDirection: "row",
          gap: spacing[2],
          marginTop: spacing[1],
        },
        bikeEditSaveBtn: {
          flex: 1,
        },
      }),
    [theme]
  );

  if (loading) return <LoadingScreen message="Loading profile..." />;

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
        <Card style={styles.section}>
          <View style={styles.avatarBlock}>
            <TouchableOpacity
              style={styles.avatarButton}
              onPress={showPhotoActions}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={
                displayImageUrl ? "Change profile photo" : "Add profile photo"
              }
            >
              {uploadingPhoto ? (
                <ActivityIndicator color={colors.amber[600]} />
              ) : displayImageUrl ? (
                <Image
                  source={{ uri: displayImageUrl }}
                  style={styles.avatarImage}
                />
              ) : (
                <Ionicons
                  name="camera-outline"
                  size={36}
                  color={theme.iconMuted}
                />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={showPhotoActions}>
              <Text style={styles.avatarHint}>
                {displayImageUrl ? "Change photo" : "Add photo"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Info</Text>
            {!editingContact && contactComplete ? (
              <TouchableOpacity onPress={beginEditContact}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {!editingContact && contactComplete ? (
            <View style={{ gap: spacing[2] }}>
              {contactSummary.map((row) => (
                <View key={row.icon} style={styles.infoRow}>
                  <Ionicons name={row.icon} size={16} color={theme.icon} />
                  <Text style={styles.infoText}>{row.text}</Text>
                </View>
              ))}
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <Input
                  label="First Name *"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  containerStyle={{ flex: 1 }}
                />
                <Input
                  label="Last Name *"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  containerStyle={{ flex: 1 }}
                />
              </View>
              <Input
                label="Email *"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                containerStyle={styles.inputGap}
              />
              <Input
                label="Phone *"
                value={formatPhoneNumber(phone)}
                onChangeText={(text) => setPhone(unformatPhoneNumber(text))}
                keyboardType="phone-pad"
                containerStyle={styles.inputGap}
              />
              <Input
                label="Address"
                placeholder="For collection / pickup"
                value={address}
                onChangeText={setAddress}
                autoCapitalize="words"
                multiline
                numberOfLines={2}
                style={{ minHeight: 64, textAlignVertical: "top" }}
                containerStyle={styles.inputGap}
              />
              <View style={styles.bikeEditActions}>
                <Button
                  title="Save"
                  onPress={handleSaveContact}
                  loading={savingContact}
                  disabled={!contactComplete}
                  style={styles.bikeEditSaveBtn}
                />
                {contactDraftReady ? (
                  <Button
                    title="Cancel"
                    onPress={cancelEditContact}
                    variant="secondary"
                  />
                ) : null}
              </View>
            </>
          )}
        </Card>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Bikes{bikes.length ? ` (${bikes.length})` : ""}
            </Text>
            {!addingBike && editingBikeId === null && !bikesLoading ? (
              <TouchableOpacity
                onPress={startAddingBike}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Add bike"
              >
                <Ionicons name="add" size={22} color={theme.icon} />
              </TouchableOpacity>
            ) : null}
          </View>

          {bikesLoading && bikes.length === 0 ? (
            <View style={styles.bikesLoadingRow}>
              <SectionLoader label="Loading bikes…" />
            </View>
          ) : null}

          {bikes.length === 0 && !addingBike && !bikesLoading ? (
            <Text style={styles.emptyText}>
              No bikes on file yet. Add one to keep them handy for booking.
            </Text>
          ) : null}

          {bikes.map((bike) => {
            const isEditing = editingBikeId === bike.id;
            const subtitle = bikeDisplaySubtitle(bike);
            return (
              <View
                key={bike.id}
                style={[styles.bikeBlock, isEditing && styles.bikeBlockEditing]}
              >
                {isEditing ? (
                  <View style={styles.bikeEditForm}>
                    <Input
                      label="Nickname (optional)"
                      placeholder="Road bike, Commuter..."
                      value={bikeNickname}
                      onChangeText={setBikeNickname}
                      containerStyle={styles.inputGap}
                    />
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
                      containerStyle={styles.inputGap}
                    />
                    <View style={styles.bikeEditActions}>
                      <Button
                        title="Save"
                        onPress={handleSaveBike}
                        loading={savingBike}
                        disabled={!bikeMake.trim() || !bikeModel.trim()}
                        size="sm"
                        style={styles.bikeEditSaveBtn}
                      />
                      <Button
                        title="Cancel"
                        onPress={resetBikeForm}
                        variant="secondary"
                        size="sm"
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.bikeRow}
                    onPress={() => startEditingBike(bike)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${bikeDisplayTitle(bike)}`}
                  >
                    <View style={styles.bikeIcon}>
                      {bike.imageUrl ? (
                        <Image
                          source={{ uri: resolveCustomerUrl(bike.imageUrl) }}
                          style={styles.bikeThumb}
                        />
                      ) : (
                        <Ionicons
                          name="bicycle-outline"
                          size={22}
                          color={colors.blue[600]}
                        />
                      )}
                    </View>
                    <View style={styles.bikeInfo}>
                      <Text style={styles.bikeTitle}>
                        {bikeDisplayTitle(bike)}
                      </Text>
                      {subtitle ? (
                        <Text style={styles.bikeSubtitle}>{subtitle}</Text>
                      ) : (
                        <Text style={styles.bikeSubtitle}>
                          Tap to edit details
                        </Text>
                      )}
                    </View>
                    <View style={styles.bikeActions}>
                      <TouchableOpacity
                        onPress={() => startEditingBike(bike)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${bikeDisplayTitle(bike)}`}
                      >
                        <Ionicons
                          name="pencil-outline"
                          size={18}
                          color={theme.icon}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteBike(bike)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${bikeDisplayTitle(bike)}`}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={18}
                          color={colors.red[500]}
                        />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {addingBike ? (
            <View style={[styles.bikeBlock, styles.bikeBlockEditing]}>
              <View style={styles.bikeEditForm}>
                <Input
                  label="Nickname (optional)"
                  placeholder="Road bike, Commuter..."
                  value={bikeNickname}
                  onChangeText={setBikeNickname}
                  containerStyle={styles.inputGap}
                />
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
                  containerStyle={styles.inputGap}
                />
                <View style={styles.bikeEditActions}>
                  <Button
                    title="Add Bike"
                    onPress={handleSaveBike}
                    loading={savingBike}
                    disabled={!bikeMake.trim() || !bikeModel.trim()}
                    size="sm"
                    style={styles.bikeEditSaveBtn}
                  />
                  <Button
                    title="Cancel"
                    onPress={resetBikeForm}
                    variant="secondary"
                    size="sm"
                  />
                </View>
              </View>
            </View>
          ) : null}
        </Card>
      </ScrollView>

      <ImageViewer
        uri={viewingPhoto ? displayImageUrl : null}
        onClose={() => setViewingPhoto(false)}
      />
    </KeyboardAvoidingView>
  );
}
