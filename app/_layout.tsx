import { useEffect, useState } from "react";
import { Alert, Linking, Modal, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StripeProvider } from "@stripe/stripe-react-native";
import { AuthProvider, useAuth } from "@/lib/auth";
import { api, parseShopSubdomainFromUrl, setCustomerShop } from "@/lib/api";
import { consumeCustomerLoginReturnPath } from "@/lib/customer-login-return";
import { NotificationProvider } from "@/lib/NotificationProvider";
import { ThemeProvider, useTheme } from "@/lib/ThemeContext";
import { BikeLoader } from "@/components/ui/BikeLoader";
import { defaultRouteForRole } from "@/lib/notification-routing";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      staleTime: 30_000,
    },
  },
});

const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const STRIPE_MERCHANT_IDENTIFIER = "merchant.com.brannonglover.bikeops.app";

function MagicLinkHandler() {
  const { setCustomerAuthenticated } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      void (async () => {
        let token: string | null = null;
        try {
          const parsed = new URL(url);
          token =
            parsed.searchParams.get("token") ??
            new URLSearchParams(parsed.hash.replace(/^#/, "")).get("token");
        } catch {
          const queryPart = url.split("?")[1]?.split("#")[0] ?? "";
          const hashPart = url.split("#")[1] ?? "";
          token =
            new URLSearchParams(queryPart).get("token") ??
            new URLSearchParams(hashPart).get("token");
        }
        if (!token) return;

        if (url.includes("/signup/verify")) {
          router.replace({
            pathname: "/(auth)/signup/verify",
            params: { token },
          });
          return;
        }

        setVerifying(true);

        const returnPath = await consumeCustomerLoginReturnPath();
        const destination =
          returnPath ??
          (url.includes("/chat/c") || /chat\/c/i.test(url)
            ? "/(customer)/chat"
            : "/(customer)/");

        try {
          const shopSub = parseShopSubdomainFromUrl(url);
          if (shopSub) {
            await setCustomerShop(shopSub);
          }
          await api.post("/api/chat/verify", { token }, { role: "customer" });
          await setCustomerAuthenticated();
          // Drop the signing-in overlay before navigating so home can paint
          // immediately instead of sitting behind the modal.
          setVerifying(false);
          router.replace(destination);
        } catch {
          setVerifying(false);
          Alert.alert("Error", "Invalid or expired link. Please try again.");
        }
      })();
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, [setCustomerAuthenticated, router]);

  if (!verifying) return null;

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.background,
        }}
      >
        <BikeLoader label="Signing you in…" />
      </View>
    </Modal>
  );
}

function AuthGate() {
  const { role, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading || !role) return;
    const root = segments[0];
    // Recover if a cold keychain timeout briefly sent us to login, or we're
    // still sitting on the bootstrap index route.
    if (root !== "(auth)" && root !== "index" && root !== undefined) return;
    router.replace(defaultRouteForRole(role) as never);
  }, [role, loading, segments, router]);

  return null;
}

function RootNav() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.statusBar} />
      <AuthGate />
      <MagicLinkHandler />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(staff)" />
        <Stack.Screen name="(customer)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StripeProvider
        publishableKey={STRIPE_PUBLISHABLE_KEY}
        merchantIdentifier={STRIPE_MERCHANT_IDENTIFIER}
        urlScheme="bikeops"
      >
        <AuthProvider>
          <NotificationProvider>
            <ThemeProvider>
              <RootNav />
            </ThemeProvider>
          </NotificationProvider>
        </AuthProvider>
      </StripeProvider>
    </QueryClientProvider>
  );
}
