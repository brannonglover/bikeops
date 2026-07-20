import { Alert } from "react-native";
import { initStripe } from "@stripe/stripe-react-native";
import { ApiError, api } from "@/lib/api";

const SHOP_NAME = process.env.EXPO_PUBLIC_SHOP_NAME ?? "Bike Shop";
const STRIPE_MERCHANT_IDENTIFIER = "merchant.com.brannonglover.bikeops.app";

export type CreateIntentResponse = {
  clientSecret: string;
  publishableKey?: string | null;
  amount: number;
  subtotal: number;
  totalPaid: number;
  originalSubtotal: number;
};

type StripeSheetFns = {
  initPaymentSheet: (params: {
    merchantDisplayName: string;
    paymentIntentClientSecret: string;
    allowsDelayedPaymentMethods?: boolean;
    returnURL?: string;
    applePay?: { merchantCountryCode: string };
    googlePay?: { merchantCountryCode: string; testEnv?: boolean };
  }) => Promise<{ error?: { code: string; message?: string } | null }>;
  presentPaymentSheet: () => Promise<{
    error?: { code: string; message?: string } | null;
  }>;
};

export type PresentJobPaymentResult =
  | { status: "success" }
  | { status: "canceled" }
  | { status: "error"; message: string };

/**
 * Creates an online PaymentIntent and presents Stripe's native Payment Sheet.
 * Keeps the customer in-app (no browser redirect).
 */
export async function presentJobPaymentSheet(
  jobId: string,
  stripe: StripeSheetFns
): Promise<PresentJobPaymentResult> {
  let intent: CreateIntentResponse;
  try {
    const { data } = await api.post<CreateIntentResponse>(
      `/api/jobs/${jobId}/payments/create-intent`,
      { mode: "online" },
      { role: "customer" }
    );
    intent = data;
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.message
        : "Failed to start payment. Please try again.";
    return { status: "error", message };
  }

  if (!intent?.clientSecret) {
    return { status: "error", message: "Payment could not be started." };
  }

  // Prefer the publishable key returned with the PaymentIntent so the app
  // always matches the backend Stripe mode (test vs live).
  const publishableKey =
    intent.publishableKey?.trim() ||
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    "";
  if (!publishableKey || publishableKey.includes("REPLACE")) {
    return {
      status: "error",
      message:
        "Stripe publishable key is not configured. Set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to a real pk_test_ or pk_live_ key.",
    };
  }

  const isTestMode = publishableKey.startsWith("pk_test_");
  await initStripe({
    publishableKey,
    merchantIdentifier: STRIPE_MERCHANT_IDENTIFIER,
    urlScheme: "bikeops",
  });

  const { error: initError } = await stripe.initPaymentSheet({
    merchantDisplayName: SHOP_NAME,
    paymentIntentClientSecret: intent.clientSecret,
    allowsDelayedPaymentMethods: false,
    returnURL: "bikeops://stripe-redirect",
    applePay: {
      merchantCountryCode: "US",
    },
    googlePay: {
      merchantCountryCode: "US",
      testEnv: isTestMode,
    },
  });

  if (initError) {
    return {
      status: "error",
      message: initError.message || "Failed to load payment sheet.",
    };
  }

  const { error: presentError } = await stripe.presentPaymentSheet();

  if (presentError) {
    if (presentError.code === "Canceled") {
      return { status: "canceled" };
    }
    return {
      status: "error",
      message: presentError.message || "Payment failed.",
    };
  }

  return { status: "success" };
}

export function alertPaymentResult(
  result: PresentJobPaymentResult,
  onSuccess?: () => void
) {
  if (result.status === "canceled") return;
  if (result.status === "error") {
    Alert.alert("Payment", result.message);
    return;
  }
  Alert.alert("Payment successful", "Thank you! Your payment went through.", [
    { text: "OK", onPress: onSuccess },
  ]);
}
