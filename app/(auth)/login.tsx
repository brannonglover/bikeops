import { useState, useMemo } from "react";
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
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";

export default function LoginScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { staffLogin, customerLogin } = useAuth();
  const [mode, setMode] = useState<"pick" | "staff" | "customer">("pick");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      }),
    [theme]
  );

  const handleStaffLogin = async () => {
    if (!email.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      const result = await staffLogin(email.trim().toLowerCase(), password);
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

  const handleCustomerContinue = async () => {
    await customerLogin();
    router.replace("/(customer)/book");
  };

  if (mode === "staff") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Staff Sign In</Text>
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={loading ? "Signing in..." : "Sign In"}
            onPress={handleStaffLogin}
            loading={loading}
            disabled={!email.trim() || !password}
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
      </View>
    </View>
  );
}
