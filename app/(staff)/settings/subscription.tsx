import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Purchase, ProductSubscription } from "expo-iap";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { getStaffBillingStatus, type StaffBillingStatus } from "@/lib/api";
import { PlatformApiError, platformApi } from "@/lib/platform-api";
import { formatDate } from "@/lib/format";
import {
  completePurchase,
  disconnectIap,
  ensureIapConnection,
  getPurchaseIds,
  isIapSupported,
  loadSubscriptionProduct,
  purchaseSubscription,
  subscribeToPurchaseEvents,
} from "@/lib/iap";

const MANAGE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
const TERMS_URL = "https://bikeops.co/terms";
const PRIVACY_URL = "https://bikeops.co/privacy";

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const days = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000);
  return Math.max(0, days);
}

export default function SubscriptionScreen() {
  const { theme } = useTheme();

  const [billing, setBilling] = useState<StaffBillingStatus | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const purchaseHandled = useRef(false);

  const iapSupported = isIapSupported();

  const loadBilling = useCallback(async () => {
    try {
      const status = await getStaffBillingStatus();
      setBilling(status);
      setError(null);
      return status;
    } catch {
      setError("Could not load your subscription details. Please try again.");
      return null;
    }
  }, []);

  const handleVerifiedPurchase = useCallback(
    async (purchase: Purchase) => {
      if (purchaseHandled.current) return;
      const shopId = billing?.shopId;
      if (!shopId) return;
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
        await loadBilling();
        setPurchasing(false);
        setNotice("Your subscription is active. Thank you!");
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
    [billing?.shopId, loadBilling]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadBilling();
      if (!cancelled) setLoadingBilling(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBilling]);

  useEffect(() => {
    if (!iapSupported) return;

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
        if (subscription) setProduct(subscription);
      } catch {
        // Product may fail to load offline; the button falls back to default copy.
      }
    })();

    return () => {
      unsubscribe();
      void disconnectIap();
    };
  }, [handleVerifiedPurchase, iapSupported]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBilling();
    setRefreshing(false);
  }, [loadBilling]);

  const handleSubscribe = async () => {
    if (!billing?.shopId) return;
    setError(null);
    setNotice(null);
    setPurchasing(true);
    purchaseHandled.current = false;
    try {
      await purchaseSubscription(billing.shopId);
    } catch (err) {
      setPurchasing(false);
      setError(err instanceof Error ? err.message : "Could not start purchase.");
    }
  };

  const handleManage = () => {
    Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() => {
      setError("Could not open App Store subscription settings.");
    });
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          padding: spacing[4],
          gap: spacing[4],
        },
        card: {
          backgroundColor: theme.surface,
          borderRadius: borderRadius["2xl"],
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          padding: spacing[5],
        },
        statusRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[3],
        },
        statusIconWrap: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
        },
        statusTitle: {
          ...fontSize.lg,
          fontWeight: "700",
          color: theme.text,
        },
        statusSubtitle: {
          ...fontSize.sm,
          color: theme.textSecondary,
          marginTop: spacing[0.5],
        },
        planBox: {
          borderRadius: borderRadius.xl,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.subtleBg,
          padding: spacing[4],
          gap: spacing[2],
          marginTop: spacing[4],
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
          marginTop: spacing[3],
        },
        notice: {
          ...fontSize.sm,
          color: colors.emerald[600],
          marginTop: spacing[3],
        },
        note: {
          ...fontSize.xs,
          color: theme.textMuted,
          lineHeight: 16,
          marginTop: spacing[4],
        },
        legalRow: {
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: spacing[2],
          paddingBottom: spacing[2],
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

  if (loadingBilling) {
    return <LoadingScreen message="Loading subscription..." />;
  }

  if (!billing) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.statusTitle}>Subscription</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              title="Try again"
              onPress={() => {
                setLoadingBilling(true);
                loadBilling().finally(() => setLoadingBilling(false));
              }}
              style={{ marginTop: spacing[4] }}
            />
          </View>
        </View>
      </View>
    );
  }

  const isActive = billing.billingActive;
  const onApple = billing.billingProvider === "apple" && billing.hasAppleSubscription;
  const daysLeft = trialDaysLeft(billing.trialEndsAt);
  const isTrialing = !billing.hasSubscription && !billing.billingExempt && daysLeft !== null;
  const displayPrice = product?.displayPrice ?? `$${billing.monthlyPrice.toFixed(2)}/month`;

  const statusColor = isActive ? colors.emerald[600] : colors.amber[600];
  const statusIcon = isActive ? "checkmark-circle" : "alert-circle";

  let statusTitle = "Payment required";
  let statusSubtitle = "Subscribe to keep using your workspace.";

  if (billing.billingExempt) {
    statusTitle = "Owned workspace";
    statusSubtitle = "No subscription is required for this workspace.";
  } else if (onApple) {
    statusTitle = "Subscription active";
    statusSubtitle = billing.appleCurrentPeriodEnd
      ? `Renews ${formatDate(billing.appleCurrentPeriodEnd)} via the App Store.`
      : "Managed through the App Store.";
  } else if (billing.hasSubscription) {
    statusTitle = "Subscription active";
    statusSubtitle = billing.currentPeriodEnd
      ? `Renews ${formatDate(billing.currentPeriodEnd)}.`
      : "Your workspace is active.";
  } else if (isTrialing) {
    statusTitle = daysLeft && daysLeft > 0 ? "Free trial" : "Trial ended";
    statusSubtitle =
      daysLeft && daysLeft > 0
        ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial.`
        : "Your free trial has ended.";
  }

  const canSubscribeHere = iapSupported && !billing.billingExempt && !onApple;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View
            style={[styles.statusIconWrap, { backgroundColor: statusColor + "22" }]}
          >
            <Ionicons name={statusIcon} size={26} color={statusColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{statusTitle}</Text>
            <Text style={styles.statusSubtitle}>{statusSubtitle}</Text>
          </View>
        </View>

        {canSubscribeHere ? (
          <>
            <View style={styles.planBox}>
              <Text style={styles.planTitle}>Bike Ops Monthly</Text>
              <Text style={styles.planDetail}>{displayPrice}</Text>
              <Text style={styles.planDetail}>
                Includes your shop subdomain, staff tools, booking board, customer chat,
                and payments.
              </Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Button
              title={
                purchasing
                  ? "Processing..."
                  : isTrialing
                    ? "Subscribe now"
                    : "Subscribe"
              }
              onPress={handleSubscribe}
              loading={purchasing}
              style={{ marginTop: spacing[5] }}
              size="lg"
            />
            <Button
              title="Manage in App Store"
              onPress={handleManage}
              variant="ghost"
              style={{ marginTop: spacing[2] }}
            />

            <Text style={styles.note}>
              Payment will be charged to your Apple ID account. Subscription automatically
              renews unless cancelled at least 24 hours before the end of the current
              period. Manage or cancel any time in your App Store account settings.
            </Text>
          </>
        ) : onApple ? (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <Button
              title="Manage in App Store"
              onPress={handleManage}
              variant="secondary"
              style={{ marginTop: spacing[5] }}
            />
          </>
        ) : billing.billingExempt ? null : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.note}>
              Manage your subscription and payment details from the Bike Ops web
              dashboard at app.bikeops.co.
            </Text>
          </>
        )}
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
    </ScrollView>
  );
}
