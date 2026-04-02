import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { type Job } from "@/lib/types";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatCurrency, jobTotal, jobBikeLabel } from "@/lib/format";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export default function PayScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const [paying, setPaying] = useState(false);

  const { data: job, isLoading } = useQuery({
    queryKey: ["pay-job", jobId],
    queryFn: async () => {
      const { data } = await api.get<Job>(`/api/jobs/${jobId}`, {
        role: "customer",
      });
      return data;
    },
    enabled: !!jobId,
  });

  if (isLoading || !job) return <LoadingScreen message="Loading payment..." />;

  const total = jobTotal(job.jobServices, job.jobProducts);

  if (job.paymentStatus === "PAID") {
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

  const handlePay = async () => {
    setPaying(true);
    try {
      // Open the web payment page in the device browser
      const payUrl = `${API_URL}/pay/${jobId}`;
      const supported = await Linking.canOpenURL(payUrl);
      if (supported) {
        await Linking.openURL(payUrl);
      } else {
        Alert.alert("Error", "Unable to open payment page.");
      }
    } catch {
      Alert.alert("Error", "Failed to open payment page.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Pay" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Card style={styles.section}>
          <Text style={styles.bikeLabel}>{jobBikeLabel(job)}</Text>

          {job.jobServices.map((js) => (
            <View key={js.id} style={styles.lineItem}>
              <Text style={styles.lineItemName}>{js.service.name}</Text>
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
            <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
          </View>
        </Card>

        <Text style={styles.info}>
          You'll be redirected to a secure payment page to complete your
          payment via card or Apple Pay.
        </Text>

        <Button
          title={paying ? "Opening..." : `Pay ${formatCurrency(total)}`}
          onPress={handlePay}
          loading={paying}
          size="lg"
        />
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
    gap: spacing[4],
    paddingBottom: spacing[12],
  },
  section: {
    gap: spacing[3],
  },
  bikeLabel: {
    ...fontSize.base,
    fontWeight: "600",
    color: colors.slate[900],
  },
  lineItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing[1],
  },
  lineItemName: {
    ...fontSize.sm,
    color: colors.slate[700],
    flex: 1,
  },
  lineItemPrice: {
    ...fontSize.sm,
    fontWeight: "600",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.slate[200],
    paddingTop: spacing[3],
    marginTop: spacing[2],
  },
  totalLabel: {
    ...fontSize.lg,
    fontWeight: "700",
    color: colors.slate[900],
  },
  totalAmount: {
    ...fontSize["2xl"],
    fontWeight: "700",
    color: colors.slate[900],
    fontVariant: ["tabular-nums"],
  },
  info: {
    ...fontSize.sm,
    color: colors.slate[500],
    textAlign: "center",
    lineHeight: 20,
  },
  paidContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[8],
    gap: spacing[4],
    backgroundColor: colors.white,
  },
  paidTitle: {
    ...fontSize.xl,
    fontWeight: "700",
    color: colors.slate[900],
  },
  paidMessage: {
    ...fontSize.sm,
    color: colors.slate[600],
    textAlign: "center",
  },
});
