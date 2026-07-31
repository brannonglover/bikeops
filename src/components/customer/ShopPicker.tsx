import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  platformApi,
  PlatformApiError,
  PLATFORM_ROOT_DOMAIN,
  type NearbyShop,
} from "@/lib/platform-api";
import type { PastShop } from "@/lib/customer-profile";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";

export type SelectedShop = { subdomain: string; name: string };

function normalizeShopCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(new RegExp(`\\.${PLATFORM_ROOT_DOMAIN.replace(/\./g, "\\.")}$`), "")
    .split("/")[0]
    ?.split(".")[0] ?? "";
}

function isValidShopCode(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

function formatDistanceMiles(shop: NearbyShop): string {
  const miles =
    typeof shop.distanceMiles === "number"
      ? shop.distanceMiles
      : typeof shop.distanceKm === "number"
        ? shop.distanceKm
        : null;
  if (miles == null) return "";
  return `${miles.toFixed(1)} mi`;
}

export function ShopPickerButton({
  selectedShop,
  onPress,
  style,
}: {
  selectedShop: SelectedShop | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
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
      }),
    [theme]
  );

  return (
    <TouchableOpacity
      style={[styles.pickerButton, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.pickerButtonText,
          !selectedShop && styles.pickerPlaceholder,
        ]}
        numberOfLines={1}
      >
        {selectedShop ? selectedShop.name : "Select a bike shop"}
      </Text>
      <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
    </TouchableOpacity>
  );
}

export function ShopPickerModal({
  visible,
  pastShops,
  selectedShop,
  onSelect,
  onClose,
}: {
  visible: boolean;
  pastShops: PastShop[];
  selectedShop: SelectedShop | null;
  onSelect: (shop: SelectedShop) => void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const [nearbyShops, setNearbyShops] = useState<NearbyShop[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyFetched, setNearbyFetched] = useState(false);
  const [shopCode, setShopCode] = useState("");
  const [shopCodeError, setShopCodeError] = useState<string | null>(null);

  const selectShopCode = () => {
    const normalized = normalizeShopCode(shopCode);
    if (!normalized) {
      setShopCodeError("Enter your shop's code (for example, bbm).");
      return;
    }
    if (!isValidShopCode(normalized)) {
      setShopCodeError("Use letters, numbers, and hyphens only.");
      return;
    }
    setShopCodeError(null);
    onSelect({ subdomain: normalized, name: normalized });
  };

  const findNearbyShops = useCallback(async () => {
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
          ? "Nearby shop search isn't available yet. Enter a shop code, or try again later."
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
  }, []);

  // Fresh installs have no past shops — auto-search nearby so App Review
  // (and new customers) see shops without hunting for the button.
  useEffect(() => {
    if (!visible) return;
    if (pastShops.length > 0) return;
    if (nearbyFetched || nearbyLoading) return;
    void findNearbyShops();
  }, [
    visible,
    pastShops.length,
    nearbyFetched,
    nearbyLoading,
    findNearbyShops,
  ]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
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
        shopCodeRow: {
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing[2],
          paddingHorizontal: spacing[3],
          marginTop: spacing[1],
        },
        shopCodeInput: {
          flex: 1,
          marginBottom: 0,
        },
        shopCodeButton: {
          marginTop: spacing[0.5],
          alignSelf: "stretch",
          justifyContent: "center",
        },
      }),
    [theme]
  );

  return (
    <BottomSheetModal
      visible={visible}
      title="Select a shop"
      onClose={onClose}
    >
      <ScrollView
        style={styles.modalList}
        keyboardShouldPersistTaps="handled"
      >
        {pastShops.length > 0 ? (
          <>
            <Text style={styles.modalSectionLabel}>Your shops</Text>
            {pastShops.map((shop) => {
              const selected = selectedShop?.subdomain === shop.subdomain;
              return (
                <TouchableOpacity
                  key={shop.subdomain}
                  style={[
                    styles.modalItem,
                    selected && styles.modalItemSelected,
                  ]}
                  onPress={() =>
                    onSelect({
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
                      {shop.subdomain}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        ) : (
          <Text style={styles.emptyShopHint}>
            No past shops yet. Enter a shop code or find one nearby to get
            started.
          </Text>
        )}

        <Text style={styles.modalSectionLabel}>Shop code</Text>
        <View style={styles.shopCodeRow}>
          <Input
            placeholder={`e.g. bbm`}
            value={shopCode}
            onChangeText={(value) => {
              setShopCode(value);
              if (shopCodeError) setShopCodeError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="done"
            onSubmitEditing={selectShopCode}
            error={shopCodeError ?? undefined}
            containerStyle={styles.shopCodeInput}
          />
          <Button
            title="Use"
            onPress={selectShopCode}
            variant="secondary"
            size="sm"
            style={styles.shopCodeButton}
          />
        </View>

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
            No shops found nearby. Try a shop code instead.
          </Text>
        ) : null}
        {nearbyShops.map((shop) => {
          const selected = selectedShop?.subdomain === shop.subdomain;
          return (
            <TouchableOpacity
              key={shop.id}
              style={[styles.modalItem, selected && styles.modalItemSelected]}
              onPress={() =>
                onSelect({
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
                    ? `${shop.address} · ${formatDistanceMiles(shop)}`
                    : `${formatDistanceMiles(shop)} away`}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </BottomSheetModal>
  );
}

/** Field + modal: past shops and nearby search. */
export function ShopPicker({
  pastShops,
  selectedShop,
  onSelect,
  style,
  hint,
}: {
  pastShops: PastShop[];
  selectedShop: SelectedShop | null;
  onSelect: (shop: SelectedShop) => void | Promise<void>;
  style?: StyleProp<ViewStyle>;
  hint?: string | null;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          gap: spacing[2],
        },
        hint: {
          ...fontSize.xs,
          color: theme.textSecondary,
        },
      }),
    [theme]
  );

  return (
    <View style={[styles.wrap, style]}>
      <ShopPickerButton
        selectedShop={selectedShop}
        onPress={() => setOpen(true)}
      />
      {hint !== null && (hint || !selectedShop) ? (
        <Text style={styles.hint}>
          {hint ??
            "Choose a shop you've used before, enter a shop code, or find one nearby."}
        </Text>
      ) : null}
      <ShopPickerModal
        visible={open}
        pastShops={pastShops}
        selectedShop={selectedShop}
        onClose={() => setOpen(false)}
        onSelect={(shop) => {
          void Promise.resolve(onSelect(shop)).finally(() => setOpen(false));
        }}
      />
    </View>
  );
}
