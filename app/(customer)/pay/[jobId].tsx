import { useState, useMemo } from "react";
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
import { colors, spacing, fontSize } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { formatCurrency, jobTotal, getJobBikeDisplayTitle } from "@/lib/format";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export default function PayScreen() {
  const { theme } = useTheme();
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
      }),
    [theme]
  );

  if (isLoading || !job) return <LoadingScreen message="Loading payment..." />;

  const total = jobTotal(job.jobServices, job.jobProducts);

  const PAYABLE_STAGES: string[] = ["RECEIVED", "WORKING_ON", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED"];

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

  if (!PAYABLE_STAGES.includes(job.stage)) {
    return (
      <View style={styles.paidContainer}>
        <Ionicons
          name="time-outline"
          size={64}
          color={colors.amber[500]}
        />
        <Text style={styles.paidTitle}>Not Yet Available</Text>
        <Text style={styles.paidMessage}>
          Payment will be available once the shop has confirmed your booking and received your bike.
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
          <Text style={styles.bikeLabel}>{getJobBikeDisplayTitle(job)}</Text>

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
