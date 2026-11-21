import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, Alert, Linking, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Purchase, ProductSubscription } from "expo-iap";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { useAuth } from "@/lib/auth";
import { PlatformApiError, platformApi } from "@/lib/platform-api";
import {
  completePurchase,
  disconnectIap,
  ensureIapConnection,
  getPurchaseIds,
  loadSubscriptionProduct,
  purchaseSubscription,
  subscribeToPurchaseEvents,
} from "@/lib/iap";

const TERMS_URL = "https://bikeops.co/terms";
const PRIVACY_URL = "https://bikeops.co/privacy";

export default function SignupSubscribeScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { staffLogin } = useAuth();
  const params = useLocalSearchParams<{
    shopId?: string;
    shopName?: string;
    subdomain?: string;
    email?: string;
    password?: string;
  }>();

  const shopId = typeof params.shopId === "string" ? params.shopId : "";
  const shopName = typeof params.shopName === "string" ? params.shopName : "your shop";
  const subdomain = typeof params.subdomain === "string" ? params.subdomain : "";
  const email = typeof params.email === "string" ? params.email : "";
  const password = typeof params.password === "string" ? params.password : "";

  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchaseHandled = useRef(false);

  const finishAndLogin = useCallback(async () => {
    if (!subdomain || !email || !password) {
      router.replace({
        pathname: "/(auth)/login",
        params: { mode: "staff", shopSubdomain: subdomain, email },
      });
      return;
    }

    const result = await staffLogin(email, password, subdomain);
    if (result.ok) {
      router.replace("/(staff)/(jobs)");
      return;
    }

    router.replace({
      pathname: "/(auth)/login",
      params: { mode: "staff", shopSubdomain: subdomain, email },
    });
  }, [email, password, router, staffLogin, subdomain]);

  const handleVerifiedPurchase = useCallback(
    async (purchase: Purchase) => {
      if (purchaseHandled.current || !shopId) return;
      purchaseHandled.current = true;

      try {
        const ids = getPurchaseIds(purchase);
        await platformApi.verifyApplePurchase({
          shopId,
          productId: ids.productId,
          transactionId: ids.transactionId,
          originalTransactionId: ids.originalTransactionId,
        });
        await completePurchase(purchase);
        await finishAndLogin();
      } catch (err) {
        purchaseHandled.current = false;
        setPurchasing(false);
        setError(
          err instanceof PlatformApiError
            ? err.message
            : "Could not activate your subscription. Please try again."
        );
      }
    },
    [finishAndLogin, shopId]
  );

  useEffect(() => {
    if (Platform.OS !== "ios" || !shopId) {
      router.replace("/(auth)/login");
      return;
    }

    let unsubscribe = () => {};

    (async () => {
      try {
        await ensureIapConnection();
        unsubscribe = subscribeToPurchaseEvents({
          onPurchase: (purchase) => {
            void handleVerifiedPurchase(purchase);
          },
          onError: (purchaseError) => {
            if (purchaseError.code === "UserCancelled") {
              setPurchasing(false);
              return;
            }
            setPurchasing(false);
            setError(purchaseError.message ?? "Purchase failed. Please try again.");
          },
        });
        const subscription = await loadSubscriptionProduct();
        setProduct(subscription);
      } catch {
        setError("Could not load subscription details from the App Store.");
      } finally {
        setLoadingProduct(false);
      }
    })();

    return () => {
      unsubscribe();
      void disconnectIap();
    };
  }, [handleVerifiedPurchase, router, shopId]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          justifyContent: "center",
          backgroundColor: theme.background,
          padding: spacing[4],
        },
        card: {
          width: "100%",
          maxWidth: 420,
          alignSelf: "center",
          backgroundColor: theme.surface,
          borderRadius: borderRadius["2xl"],
          padding: spacing[8],
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
        },
        title: {
          ...fontSize["2xl"],
          fontWeight: "700",
          color: theme.text,
          textAlign: "center",
        },
        subtitle: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
          marginTop: spacing[3],
          lineHeight: 20,
        },
        planBox: {
          marginTop: spacing[6],
          borderRadius: borderRadius.xl,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.subtleBg,
          padding: spacing[4],
          gap: spacing[2],
        },
        planTitle: {
          ...fontSize.base,
          fontWeight: "600",
          color: theme.text,
        },
        planDetail: {
          ...fontSize.sm,
          color: theme.textSecondary,
          lineHeight: 20,
        },
        error: {
          ...fontSize.sm,
          color: colors.red[600],
          textAlign: "center",
          marginTop: spacing[4],
        },
        note: {
          ...fontSize.xs,
          color: theme.textMuted,
          textAlign: "center",
          marginTop: spacing[4],
          lineHeight: 16,
        },
        legalRow: {
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: spacing[2],
          marginTop: spacing[5],
        },
        legalLink: {
          ...fontSize.xs,
          color: theme.textSecondary,
          textDecorationLine: "underline",
        },
        legalDivider: {
          ...fontSize.xs,
          color: theme.textMuted,
        },
      }),
    [theme]
  );

  const handleSubscribe = async () => {
    if (!shopId) return;
    setError(null);
    setPurchasing(true);
    purchaseHandled.current = false;
    try {
      await purchaseSubscription(shopId);
    } catch (err) {
      setPurchasing(false);
      setError(err instanceof Error ? err.message : "Could not start purchase.");
    }
  };

  const handleRestore = () => {
    Alert.alert(
      "Restore purchases",
      "If you already subscribed on this Apple ID, open the App Store subscription settings to restore access, then sign in to your workspace.",
      [{ text: "OK" }]
    );
  };

  if (loadingProduct) {
    return <LoadingScreen message="Loading subscription..." />;
  }

  const displayPrice = product?.displayPrice ?? "$39.99/month";

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Ionicons
          name="storefront-outline"
          size={48}
          color={theme.iconMuted}
          style={{ alignSelf: "center" }}
        />
        <Text style={styles.title}>{shopName} is ready</Text>
        <Text style={styles.subtitle}>
          Start your Bike Ops subscription to activate your workspace. Billing is handled
          through Apple — web and desktop signups continue to use Stripe separately.
        </Text>

        <View style={styles.planBox}>
          <Text style={styles.planTitle}>Bike Ops Monthly</Text>
          <Text style={styles.planDetail}>{displayPrice} after a 14-day free trial</Text>
          <Text style={styles.planDetail}>
            Includes your shop subdomain, staff tools, booking board, customer chat, and
            payments.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={purchasing ? "Processing..." : "Start free trial"}
          onPress={handleSubscribe}
          loading={purchasing}
          disabled={!product}
          style={{ marginTop: spacing[6] }}
          size="lg"
        />

        <Button
          title="Restore purchases"
          onPress={handleRestore}
          variant="ghost"
          style={{ marginTop: spacing[2] }}
        />

        <Text style={styles.note}>
          Payment will be charged to your Apple ID account. Subscription automatically
          renews unless cancelled at least 24 hours before the end of the current period.
        </Text>
      </View>

      <View style={styles.legalRow}>
        <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
          <Text style={styles.legalLink}>Terms of Service</Text>
        </TouchableOpacity>
        <Text style={styles.legalDivider}>·</Text>
        <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
