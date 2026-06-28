import { useEffect } from "react";
import { Linking, Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { NotificationProvider } from "@/lib/NotificationProvider";
import { ThemeProvider, useTheme } from "@/lib/ThemeContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function MagicLinkHandler() {
  const { setCustomerAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
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

      api
        .post("/api/chat/verify", { token }, { role: "customer" })
        .then(() => setCustomerAuthenticated())
        .then(() => router.replace("/(customer)/chat"))
        .catch(() => Alert.alert("Error", "Invalid or expired link. Please try again."));
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, [setCustomerAuthenticated, router]);

  return null;
}

function RootNav() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.statusBar} />
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
      <AuthProvider>
        <NotificationProvider>
          <ThemeProvider>
            <RootNav />
          </ThemeProvider>
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
