import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { PlatformApiError, platformApi } from "@/lib/platform-api";
import { isIapSupported } from "@/lib/iap";

type VerifyState =
  | { status: "loading" }
  | { status: "success"; shopId: string; shopName: string; subdomain: string; email: string; password: string }
  | { status: "error"; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "This verification link is invalid or has already been used.",
  expired: "This verification link has expired. Please sign up again to receive a new email.",
  subdomain_taken:
    "That subdomain was claimed while you were verifying. Please sign up again with a different subdomain.",
};

export default function SignupVerifyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; email?: string; password?: string }>();
  const [state, setState] = useState<VerifyState>({ status: "loading" });

  useEffect(() => {
    const token = typeof params.token === "string" ? params.token : null;
    if (!token) {
      setState({
        status: "error",
        message: ERROR_MESSAGES.invalid,
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await platformApi.verifySignup(token);
        if (cancelled) return;
        setState({
          status: "success",
          shopId: data.shop.id,
          shopName: data.shop.name,
          subdomain: data.shop.subdomain,
          email: typeof params.email === "string" ? params.email : "",
          password: typeof params.password === "string" ? params.password : "",
        });
      } catch (err) {
        if (cancelled) return;
        const code =
          err instanceof PlatformApiError && typeof err.message === "string"
            ? err.message
            : "invalid";
        setState({
          status: "error",
          message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.invalid,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.token, params.email, params.password]);

  useEffect(() => {
    if (state.status !== "success") return;

    if (isIapSupported()) {
      router.replace({
        pathname: "/(auth)/signup/subscribe",
        params: {
          shopId: state.shopId,
          shopName: state.shopName,
          subdomain: state.subdomain,
          email: state.email,
          password: state.password,
        },
      });
      return;
    }

    router.replace({
      pathname: "/(auth)/login",
      params: {
        mode: "staff",
        shopSubdomain: state.subdomain,
        email: state.email,
        verified: "1",
      },
    });
  }, [state, router]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.background,
          padding: spacing[4],
        },
        card: {
          width: "100%",
          maxWidth: 420,
          backgroundColor: theme.surface,
          borderRadius: borderRadius["2xl"],
          padding: spacing[8],
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          alignItems: "center",
        },
        title: {
          ...fontSize.xl,
          fontWeight: "600",
          color: theme.text,
          textAlign: "center",
          marginTop: spacing[3],
        },
        body: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
          marginTop: spacing[3],
          lineHeight: 20,
        },
      }),
    [theme]
  );

  if (state.status === "loading") {
    return <LoadingScreen message="Confirming your email..." />;
  }

  if (state.status === "success") {
    return <LoadingScreen message="Setting up your workspace..." />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Ionicons name="close-circle-outline" size={48} color={colors.red[600]} />
        <Text style={styles.title}>Could not verify email</Text>
        <Text style={styles.body}>{state.message}</Text>
        <Button
          title="Back to signup"
          onPress={() => router.replace("/(auth)/signup")}
          style={{ marginTop: spacing[6], width: "100%" }}
        />
      </View>
    </View>
  );
}
