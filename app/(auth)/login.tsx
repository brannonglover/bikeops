import { useState } from "react";
import {
  View,
  Text,
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

export default function LoginScreen() {
  const router = useRouter();
  const { staffLogin, customerLogin } = useAuth();
  const [mode, setMode] = useState<"pick" | "staff" | "customer">("pick");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const handleCustomerContinue = () => {
    customerLogin();
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
        <Text style={styles.logo}>BikeOps</Text>
        <Text style={styles.subtitle}>
          {process.env.EXPO_PUBLIC_SHOP_NAME ?? "Bike Shop Management"}
        </Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.slate[50],
    padding: spacing[4],
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.white,
    borderRadius: borderRadius["2xl"],
    padding: spacing[8],
    borderWidth: 1,
    borderColor: colors.slate[200],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  logo: {
    ...fontSize["3xl"],
    fontWeight: "700",
    color: colors.slate[900],
    textAlign: "center",
    marginBottom: spacing[1],
  },
  subtitle: {
    ...fontSize.sm,
    color: colors.slate[500],
    textAlign: "center",
    marginBottom: spacing[8],
  },
  title: {
    ...fontSize.xl,
    fontWeight: "600",
    color: colors.slate[900],
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
    color: colors.slate[500],
    fontWeight: "500",
  },
});
