import { useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import {
  PlatformApiError,
  platformApi,
  slugifySubdomain,
  PLATFORM_ROOT_DOMAIN,
} from "@/lib/platform-api";

export default function SignupScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [shopName, setShopName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingSubdomain, setPendingSubdomain] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  const previewSubdomain = useMemo(
    () => slugifySubdomain(subdomain || shopName) || "your-shop",
    [shopName, subdomain]
  );

  const effectiveSubdomain = useMemo(
    () => slugifySubdomain(subdomain || shopName),
    [shopName, subdomain]
  );

  const canSubmit = useMemo(
    () =>
      shopName.trim().length >= 2 &&
      effectiveSubdomain.length >= 3 &&
      ownerName.trim().length >= 2 &&
      email.trim().length > 0 &&
      password.length >= 8,
    [shopName, effectiveSubdomain, ownerName, email, password]
  );

  const submitHint = useMemo(() => {
    if (canSubmit) return null;
    if (password.length === 0) {
      return "Enter a password with at least 8 characters to continue.";
    }
    if (password.length < 8) {
      return `Password needs ${8 - password.length} more character${8 - password.length === 1 ? "" : "s"}.`;
    }
    if (effectiveSubdomain.length < 3) {
      return "Choose a subdomain with at least 3 characters.";
    }
    if (shopName.trim().length < 2) {
      return "Enter your shop name.";
    }
    if (ownerName.trim().length < 2) {
      return "Enter your name.";
    }
    if (!email.trim()) {
      return "Enter your email address.";
    }
    return null;
  }, [canSubmit, password.length, effectiveSubdomain.length, shopName, ownerName, email]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.background,
        },
        content: {
          flexGrow: 1,
          justifyContent: "center",
          padding: spacing[4],
          paddingVertical: spacing[8],
        },
        card: {
          width: "100%",
          maxWidth: 480,
          alignSelf: "center",
          backgroundColor: theme.surface,
          borderRadius: borderRadius["2xl"],
          padding: spacing[6],
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
        },
        logo: {
          width: 220,
          height: 100,
          alignSelf: "center",
          marginBottom: spacing[4],
        },
        title: {
          ...fontSize["2xl"],
          fontWeight: "700",
          color: theme.text,
          marginBottom: spacing[2],
        },
        subtitle: {
          ...fontSize.sm,
          color: theme.textSecondary,
          lineHeight: 20,
          marginBottom: spacing[5],
        },
        preview: {
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.subtleBg,
          padding: spacing[3],
          marginBottom: spacing[5],
        },
        previewLabel: {
          ...fontSize.sm,
          fontWeight: "600",
          color: theme.text,
        },
        previewValue: {
          ...fontSize.sm,
          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          color: theme.textSecondary,
          marginTop: spacing[1],
        },
        inputContainer: {
          marginBottom: spacing[3],
        },
        suffixRow: {
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: theme.inputBorder,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.inputBg,
          overflow: "hidden",
        },
        suffixInput: {
          flex: 1,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2.5],
          fontSize: fontSize.base.fontSize,
          color: theme.inputText,
        },
        suffixLabel: {
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2.5],
          borderLeftWidth: 1,
          borderLeftColor: theme.inputBorder,
          backgroundColor: theme.subtleBg,
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        passwordRow: {
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: theme.inputBorder,
          borderRadius: borderRadius.lg,
          backgroundColor: theme.inputBg,
        },
        passwordInput: {
          flex: 1,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2.5],
          fontSize: fontSize.base.fontSize,
          color: theme.inputText,
        },
        passwordToggle: {
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2.5],
        },
        fieldHint: {
          ...fontSize.xs,
          color: theme.textSecondary,
          marginTop: spacing[1],
        },
        submitHint: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
          marginBottom: spacing[3],
        },
        error: {
          ...fontSize.sm,
          color: colors.red[600],
          marginBottom: spacing[3],
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
        successIcon: {
          alignSelf: "center",
          marginBottom: spacing[3],
        },
        successTitle: {
          ...fontSize.xl,
          fontWeight: "600",
          color: theme.text,
          textAlign: "center",
          marginBottom: spacing[2],
        },
        successBody: {
          ...fontSize.sm,
          color: theme.textSecondary,
          textAlign: "center",
          lineHeight: 20,
        },
        successEmail: {
          fontWeight: "600",
          color: theme.text,
        },
      }),
    [theme]
  );

  const handleShopNameChange = (value: string) => {
    setShopName(value);
    if (!subdomainEdited) {
      setSubdomain(slugifySubdomain(value));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const data = await platformApi.startSignup({
        shopName: shopName.trim(),
        subdomain: effectiveSubdomain,
        ownerName: ownerName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      setPendingEmail(data.email ?? email.trim().toLowerCase());
      setPendingSubdomain(effectiveSubdomain);
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message
          : "Could not create your shop. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!pendingEmail) return;
    setResendMessage(null);
    setResendError(null);
    setResendLoading(true);
    try {
      const data = await platformApi.resendSignup(
        pendingEmail,
        pendingSubdomain ?? undefined
      );
      setResendMessage(data.message ?? "We sent another confirmation email.");
    } catch (err) {
      setResendError(
        err instanceof PlatformApiError
          ? err.message
          : "Could not resend confirmation email."
      );
    } finally {
      setResendLoading(false);
    }
  };

  if (pendingEmail) {
    return (
      <View style={styles.container}>
        <View style={[styles.content, { justifyContent: "center" }]}>
          <View style={styles.card}>
            <Ionicons
              name="mail-outline"
              size={48}
              color={theme.iconMuted}
              style={styles.successIcon}
            />
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successBody}>
              We sent a confirmation link to{" "}
              <Text style={styles.successEmail}>{pendingEmail}</Text>. Tap the link to
              finish creating your workspace.
            </Text>
            <Text style={[styles.successBody, { marginTop: spacing[3] }]}>
              The link expires in 24 hours. If you do not see the email, check your spam
              folder.
            </Text>
            <View style={{ marginTop: spacing[5], gap: spacing[3] }}>
              <Button
                title={resendLoading ? "Sending..." : "Resend confirmation email"}
                onPress={handleResend}
                loading={resendLoading}
                variant="secondary"
              />
              {resendMessage ? (
                <Text
                  style={{
                    ...fontSize.sm,
                    color: colors.emerald[600],
                    textAlign: "center",
                  }}
                >
                  {resendMessage}
                </Text>
              ) : null}
              {resendError ? (
                <Text style={{ ...fontSize.sm, color: colors.red[600], textAlign: "center" }}>
                  {resendError}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
              <Text style={styles.backText}>Back to login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Image
            source={require("../../../assets/splash-icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Create a bike shop workspace</Text>
          <Text style={styles.subtitle}>
            Each shop gets its own subdomain, staff login, booking board, settings,
            templates, and customer history.
          </Text>

          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Workspace preview</Text>
            <Text style={styles.previewValue}>
              {previewSubdomain}.{PLATFORM_ROOT_DOMAIN}
            </Text>
          </View>

          <Input
            label="Shop name"
            placeholder="Example Bike Shop"
            value={shopName}
            onChangeText={handleShopNameChange}
            autoCapitalize="words"
            containerStyle={styles.inputContainer}
          />

          <View style={styles.inputContainer}>
            <Text
              style={{
                ...fontSize.sm,
                fontWeight: "500",
                color: theme.textTertiary,
                marginBottom: spacing[1],
              }}
            >
              Subdomain
            </Text>
            <View style={styles.suffixRow}>
              <TextInput
                placeholder="example"
                placeholderTextColor={theme.textMuted}
                value={subdomainEdited ? subdomain : subdomain || slugifySubdomain(shopName)}
                onChangeText={(value) => {
                  setSubdomainEdited(true);
                  setSubdomain(slugifySubdomain(value));
                }}
                onFocus={() => {
                  if (!subdomainEdited && !subdomain && shopName.trim()) {
                    setSubdomain(slugifySubdomain(shopName));
                  }
                }}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.suffixInput}
              />
              <Text style={styles.suffixLabel}>.{PLATFORM_ROOT_DOMAIN}</Text>
            </View>
          </View>

          <Input
            label="Your name"
            placeholder="Alex Morgan"
            value={ownerName}
            onChangeText={setOwnerName}
            autoCapitalize="words"
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
            textContentType="emailAddress"
            containerStyle={styles.inputContainer}
          />

          <View style={styles.inputContainer}>
            <Text
              style={{
                ...fontSize.sm,
                fontWeight: "500",
                color: theme.textTertiary,
                marginBottom: spacing[1],
              }}
            >
              Password
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                placeholder="At least 8 characters"
                placeholderTextColor={theme.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.passwordInput}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((current) => !current)}
                style={styles.passwordToggle}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color={theme.icon}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldHint}>
              {password.length > 0
                ? `${password.length}/8 characters${password.length >= 8 ? " — ready" : ""}`
                : "Required — at least 8 characters"}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!canSubmit && submitHint ? (
            <Text style={styles.submitHint}>{submitHint}</Text>
          ) : null}

          <Button
            title={loading ? "Sending confirmation email..." : "Create workspace"}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          />

          <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backText}>Back to login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
