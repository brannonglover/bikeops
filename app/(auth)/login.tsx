import { useEffect, useState, useMemo, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import {
  api,
  ApiError,
  getLastStaffShopSubdomain,
  getCustomerShop,
  setCustomerShop,
} from "@/lib/api";
import {
  getCustomerProfile,
  rememberShop,
  type PastShop,
} from "@/lib/customer-profile";
import { setCustomerLoginReturnPath } from "@/lib/customer-login-return";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  ShopPicker,
  type SelectedShop,
} from "@/components/customer/ShopPicker";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

/** Temporary App Store Review demo email — password lives only on the server. */
const APPLE_REVIEW_EMAIL = "appreview@bikeops.co";
/** Must match APPLE_REVIEW_SHOP_SUBDOMAIN on the server (default: appreview). */
const APPLE_REVIEW_SHOP: SelectedShop = {
  subdomain: "appreview",
  name: "Stevens Creek Cycles",
};

export default function LoginScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    shopSubdomain?: string;
    email?: string;
    verified?: string;
  }>();
  const { staffLogin, setCustomerAuthenticated } = useAuth();
  const [mode, setMode] = useState<"pick" | "staff" | "customer">("pick");
  const [shopSubdomain, setShopSubdomain] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPassword, setCustomerPassword] = useState("");
  const [requestingLogin, setRequestingLogin] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [selectedShop, setSelectedShop] = useState<SelectedShop | null>(null);
  const [pastShops, setPastShops] = useState<PastShop[]>([]);

  const isAppleReviewEmail =
    customerEmail.trim().toLowerCase() === APPLE_REVIEW_EMAIL;

  const selectCustomerShop = useCallback(async (shop: SelectedShop) => {
    await setCustomerShop(shop.subdomain, shop.name);
    const profile = await rememberShop(shop.subdomain, shop.name);
    setPastShops(profile.pastShops);
    setSelectedShop(shop);
  }, []);

  useEffect(() => {
    getLastStaffShopSubdomain()
      .then((lastShop) => {
        if (lastShop) setShopSubdomain(lastShop);
      })
      .catch(() => {});
  }, []);

  // Fresh installs have no past shops; nearby search won't find the demo shop
  // from Apple's review devices. Auto-select the review shop when they use the
  // demo email so they aren't stuck on "No past shops yet".
  useEffect(() => {
    if (!isAppleReviewEmail) return;
    if (selectedShop?.subdomain === APPLE_REVIEW_SHOP.subdomain) return;
    void selectCustomerShop(APPLE_REVIEW_SHOP);
  }, [isAppleReviewEmail, selectedShop?.subdomain, selectCustomerShop]);

  useEffect(() => {
    if (params.mode === "staff") {
      setMode("staff");
    }
    if (typeof params.shopSubdomain === "string" && params.shopSubdomain) {
      setShopSubdomain(params.shopSubdomain);
    }
    if (typeof params.email === "string" && params.email) {
      setEmail(params.email);
    }
  }, [params.mode, params.shopSubdomain, params.email]);

  useEffect(() => {
    if (mode !== "customer") return;
    let cancelled = false;
    (async () => {
      const profile = await getCustomerProfile();
      if (cancelled) return;
      setPastShops(profile.pastShops);
      if (profile.email) {
        setCustomerEmail((prev) => prev || profile.email);
      }
      const stored = await getCustomerShop();
      if (cancelled) return;
      if (stored?.subdomain) {
        setSelectedShop({
          subdomain: stored.subdomain,
          name: stored.name ?? stored.subdomain,
        });
      } else if (profile.pastShops[0]) {
        const shop = profile.pastShops[0];
        setSelectedShop({ subdomain: shop.subdomain, name: shop.name });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const handleCustomerLogin = async () => {
    if (!customerEmail.trim() || !selectedShop) return;
    if (isAppleReviewEmail && !customerPassword) return;

    setRequestingLogin(true);
    setLoginMessage(null);
    try {
      await setCustomerShop(selectedShop.subdomain, selectedShop.name);
      await setCustomerLoginReturnPath("/(customer)/");

      if (isAppleReviewEmail) {
        await api.post(
          "/api/chat/review-login",
          {
            email: customerEmail.trim().toLowerCase(),
            password: customerPassword,
          },
          { role: "customer" }
        );
        await setCustomerAuthenticated();
        router.replace("/(customer)/");
        return;
      }

      const { data } = await api.post<{ message?: string }>(
        "/api/chat/request-login",
        { email: customerEmail.trim().toLowerCase() },
        { role: "customer" }
      );
      setLoginMessage(
        data.message ?? "Check your email for a login link. It may take a minute."
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.";
      setLoginMessage(message);
    } finally {
      setRequestingLogin(false);
    }
  };

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
          maxWidth: 400,
          backgroundColor: theme.surface,
          borderRadius: borderRadius["2xl"],
          padding: spacing[8],
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          elevation: 5,
        },
        logo: {
          width: 300,
          height: 140,
          alignSelf: "center",
          marginBottom: spacing[1],
        },
        title: {
          ...fontSize.xl,
          fontWeight: "600",
          color: theme.text,
          textAlign: "center",
          marginBottom: spacing[6],
        },
        inputContainer: {
          marginBottom: spacing[4],
        },
        shopField: {
          marginBottom: spacing[4],
        },
        shopLabel: {
          ...fontSize.sm,
          fontWeight: "500",
          color: theme.textTertiary,
          marginBottom: spacing[1],
        },
        error: {
          ...fontSize.sm,
          color: colors.red[600],
          marginBottom: spacing[3],
        },
        button: {
          marginTop: spacing[2],
        },
        buttonGroup: {
          gap: spacing[3],
        },
        roleButton: {
          width: "100%",
        },
        backLink: {
          alignItems: "center",
          marginTop: spacing[4],
          padding: spacing[2],
        },
        backText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          fontWeight: "500",
        },
        registerLink: {
          alignItems: "center",
          marginTop: spacing[5],
          padding: spacing[2],
          gap: spacing[1],
        },
        registerText: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
        },
        registerAction: {
          ...fontSize.sm,
          color: colors.amber[600],
          fontWeight: "600",
          textAlign: "center",
        },
        verifiedBanner: {
          ...fontSize.sm,
          color: colors.emerald[600],
          textAlign: "center",
          marginBottom: spacing[3],
        },
      }),
    [theme]
  );

  const handleStaffLogin = async () => {
    if (!shopSubdomain.trim() || !email.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      const result = await staffLogin(
        email.trim().toLowerCase(),
        password,
        shopSubdomain.trim().toLowerCase()
      );
      if (result.ok) {
        router.replace("/(staff)/(jobs)");
      } else {
        setError(result.error ?? "Login failed");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerContinue = () => {
    setMode("customer");
  };

  if (mode === "customer") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.card}>
          <Ionicons
            name="mail-outline"
            size={48}
            color={theme.iconMuted}
            style={{ alignSelf: "center", marginBottom: spacing[2] }}
          />
          <Text style={styles.title}>Customer Login</Text>
          <Text
            style={{
              ...fontSize.sm,
              color: theme.textSecondary,
              textAlign: "center",
              marginBottom: spacing[4],
            }}
          >
            {isAppleReviewEmail
              ? "Demo shop is selected (Stevens Creek Cycles). Enter the App Review password to sign in."
              : "Choose your bike shop, then enter your email for a login link."}
          </Text>
          <View style={styles.shopField}>
            <Text style={styles.shopLabel}>Bike Shop</Text>
            <ShopPicker
              pastShops={pastShops}
              selectedShop={selectedShop}
              onSelect={selectCustomerShop}
            />
          </View>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={customerEmail}
            onChangeText={setCustomerEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            containerStyle={styles.inputContainer}
          />
          {isAppleReviewEmail ? (
            <Input
              label="Password"
              placeholder="••••••••"
              value={customerPassword}
              onChangeText={setCustomerPassword}
              secureTextEntry
              autoComplete="password"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={styles.inputContainer}
            />
          ) : null}
          {loginMessage ? (
            <Text
              style={{
                ...fontSize.sm,
                color: loginMessage.toLowerCase().includes("invalid")
                  ? colors.red[600]
                  : colors.emerald[600],
                textAlign: "center",
                marginBottom: spacing[3],
              }}
            >
              {loginMessage}
            </Text>
          ) : null}
          <Button
            title={
              requestingLogin
                ? isAppleReviewEmail
                  ? "Signing in..."
                  : "Sending..."
                : isAppleReviewEmail
                  ? "Sign In"
                  : "Send Login Link"
            }
            onPress={handleCustomerLogin}
            loading={requestingLogin}
            disabled={
              !customerEmail.trim() ||
              !selectedShop ||
              (isAppleReviewEmail && !customerPassword)
            }
            style={styles.button}
          />
          <TouchableOpacity onPress={() => setMode("pick")} style={styles.backLink}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (mode === "staff") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Staff Sign In</Text>
          <Input
            label="Shop"
            placeholder="bbm"
            value={shopSubdomain}
            onChangeText={setShopSubdomain}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="URL"
            containerStyle={styles.inputContainer}
          />
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            containerStyle={styles.inputContainer}
          />
          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            containerStyle={styles.inputContainer}
          />
          {params.verified === "1" ? (
            <Text style={styles.verifiedBanner}>
              Your workspace is ready. Sign in to get started.
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={loading ? "Signing in..." : "Sign In"}
            onPress={handleStaffLogin}
            loading={loading}
            disabled={!shopSubdomain.trim() || !email.trim() || !password}
            style={styles.button}
          />
          <TouchableOpacity onPress={() => setMode("pick")} style={styles.backLink}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Image
          source={require("../../assets/splash-icon.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={styles.buttonGroup}>
          <Button
            title="Staff Login"
            onPress={() => setMode("staff")}
            variant="primary"
            size="lg"
            style={styles.roleButton}
          />
          <Button
            title="I'm a Customer"
            onPress={handleCustomerContinue}
            variant="secondary"
            size="lg"
            style={styles.roleButton}
          />
        </View>
        <TouchableOpacity
          onPress={() => router.push("/(auth)/signup")}
          style={styles.registerLink}
        >
          <Text style={styles.registerText}>Not a customer yet?</Text>
          <Text style={styles.registerAction}>Register your shop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
