import { useState, useMemo, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useStripe } from "@stripe/stripe-react-native";
import { ApiError, api } from "@/lib/api";
import { type Job } from "@/lib/types";
import { colors, spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatCurrency, getJobBikeDisplayTitle } from "@/lib/format";
import { computeJobSubtotal, getJobPaymentSummary } from "@/lib/job-payments";
import {
  alertPaymentResult,
  presentJobPaymentSheet,
} from "@/lib/customer-payment";

export default function PayScreen() {
  const { theme } = useTheme();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [paying, setPaying] = useState(false);

  const { data: job, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pay-job", jobId],
    queryFn: async () => {
      const { data } = await api.get<Job[]>("/api/customer/jobs", {
        role: "customer",
      });
      const match = data.find((j) => j.id === jobId);
      if (!match) throw new ApiError("Job not found", 404);
      return match;
    },
    enabled: !!jobId,
  });

  const handlePay = useCallback(async () => {
    if (!jobId || paying) return;
    setPaying(true);
    try {
      const result = await presentJobPaymentSheet(jobId, {
        initPaymentSheet,
        presentPaymentSheet,
      });
      alertPaymentResult(result, () => {
        void refetch();
        router.replace(`/(customer)/status/${jobId}`);
      });
      if (result.status === "success") {
        void refetch();
      }
    } finally {
      setPaying(false);
    }
  }, [
    jobId,
    paying,
    initPaymentSheet,
    presentPaymentSheet,
    refetch,
    router,
  ]);

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
          paddingBottom: spacing[12],
        },
        section: {
          gap: spacing[3],
        },
        bikeLabel: {
          ...fontSize.base,
          fontWeight: "600",
          color: theme.text,
        },
        lineItem: {
          flexDirection: "row",
          justifyContent: "space-between",
          paddingVertical: spacing[1],
        },
        lineItemName: {
          ...fontSize.sm,
          color: theme.textTertiary,
          flex: 1,
        },
        lineItemPrice: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
        totalRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          borderTopWidth: 1,
          borderTopColor: theme.surfaceBorder,
          paddingTop: spacing[3],
          marginTop: spacing[2],
        },
        totalLabel: {
          ...fontSize.lg,
          fontWeight: "700",
          color: theme.text,
        },
        totalAmount: {
          ...fontSize["2xl"],
          fontWeight: "700",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
        summaryRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        summaryLabel: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        summaryValue: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
          fontVariant: ["tabular-nums"],
        },
        summaryPaid: {
          color: colors.emerald[700],
        },
        summaryRemaining: {
          color: colors.amber[700],
        },
        info: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
          lineHeight: 20,
        },
        paidContainer: {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing[8],
          gap: spacing[4],
          backgroundColor: theme.surface,
        },
        paidTitle: {
          ...fontSize.xl,
          fontWeight: "700",
          color: theme.text,
        },
        paidMessage: {
          ...fontSize.sm,
          color: theme.textTertiary,
          textAlign: "center",
        },
        errorWrap: {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing[6],
          gap: spacing[3],
          backgroundColor: theme.background,
        },
        errorText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
        },
      }),
    [theme]
  );

  if (isLoading) return <LoadingScreen message="Loading payment..." />;

  if (isError || !job) {
    const message =
      error instanceof ApiError
        ? error.message
        : "Couldn't load this job. Please try again.";
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorText}>{message}</Text>
        <Button title="Try Again" onPress={() => void refetch()} />
      </View>
    );
  }

  const subtotal = computeJobSubtotal({
    jobServices: job.jobServices,
    jobProducts: job.jobProducts,
  });
  const paymentSummary = getJobPaymentSummary({
    currentStatus: job.paymentStatus,
    subtotal,
    totalPaid:
      typeof job.totalPaid === "number" && Number.isFinite(job.totalPaid)
        ? job.totalPaid
        : 0,
  });
  const hasPartialPayment =
    paymentSummary.totalPaid > 0 && !paymentSummary.isPaidInFull;

  const PAYABLE_STAGES: string[] = [
    "RECEIVED",
    "WORKING_ON",
    "WAITING_ON_CUSTOMER",
    "WAITING_ON_PARTS",
    "BIKE_READY",
    "COMPLETED",
  ];

  if (paymentSummary.isPaidInFull || paymentSummary.remaining <= 0) {
    return (
      <View style={styles.paidContainer}>
        <Ionicons
          name="checkmark-circle"
          size={64}
          color={colors.emerald[500]}
        />
        <Text style={styles.paidTitle}>Already Paid</Text>
        <Text style={styles.paidMessage}>
          This job has already been paid. Thank you!
        </Text>
        <Button
          title="View Status"
          onPress={() => router.replace(`/(customer)/status/${jobId}`)}
          variant="secondary"
        />
      </View>
    );
  }

  if (!PAYABLE_STAGES.includes(job.stage)) {
    return (
      <View style={styles.paidContainer}>
        <Ionicons name="time-outline" size={64} color={colors.amber[500]} />
        <Text style={styles.paidTitle}>Not Yet Available</Text>
        <Text style={styles.paidMessage}>
          Payment will be available once the shop has confirmed your booking and
          received your bike.
        </Text>
        <Button
          title="View Status"
          onPress={() => router.replace(`/(customer)/status/${jobId}`)}
          variant="secondary"
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Pay" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Card style={styles.section}>
          <Text style={styles.bikeLabel}>{getJobBikeDisplayTitle(job)}</Text>

          {job.jobServices.map((js) => (
            <View key={js.id} style={styles.lineItem}>
              <Text style={styles.lineItemName}>
                {js.service?.name ?? js.customServiceName ?? "Service"}
              </Text>
              <Text style={styles.lineItemPrice}>
                {formatCurrency(parseFloat(js.unitPrice) * js.quantity)}
              </Text>
            </View>
          ))}
          {job.jobProducts.map((jp) => (
            <View key={jp.id} style={styles.lineItem}>
              <Text style={styles.lineItemName}>{jp.product.name}</Text>
              <Text style={styles.lineItemPrice}>
                {formatCurrency(parseFloat(jp.unitPrice) * jp.quantity)}
              </Text>
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCurrency(subtotal)}</Text>
          </View>
          {hasPartialPayment ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Already paid</Text>
                <Text style={[styles.summaryValue, styles.summaryPaid]}>
                  {formatCurrency(paymentSummary.totalPaid)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Remaining balance</Text>
                <Text style={[styles.summaryValue, styles.summaryRemaining]}>
                  {formatCurrency(paymentSummary.remaining)}
                </Text>
              </View>
            </>
          ) : null}
        </Card>

        <Text style={styles.info}>
          Pay securely in the app with Apple Pay, Google Pay, or card.
        </Text>

        <Button
          title={
            paying
              ? "Processing..."
              : hasPartialPayment
                ? `Pay ${formatCurrency(paymentSummary.remaining)}`
                : `Pay ${formatCurrency(subtotal)}`
          }
          onPress={() => void handlePay()}
          loading={paying}
          size="lg"
        />
      </ScrollView>
    </>
  );
}
