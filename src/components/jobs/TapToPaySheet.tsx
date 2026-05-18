import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import type { Reader } from "@stripe/stripe-terminal-react-native";
import { api } from "@/lib/api";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/Button";

type Phase =
  | "idle"
  | "discovering"
  | "connecting"
  | "creating_intent"
  | "collecting"
  | "processing"
  | "success"
  | "error";

interface TapToPaySheetProps {
  visible: boolean;
  jobId: string;
  total: number;
  onClose: () => void;
  onJobPaid: () => void;
}

const SHOP_NAME =
  process.env.EXPO_PUBLIC_SHOP_NAME ?? "Bike Shop";
const TERMINAL_LOCATION_ID =
  process.env.EXPO_PUBLIC_STRIPE_TERMINAL_LOCATION_ID ?? "";

function getTapToPayErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("proximity") ||
    lower.includes("entitlement") ||
    lower.includes("not supported") ||
    lower.includes("unsupported") ||
    lower.includes("local mobile")
  ) {
    return "Tap to Pay is not available on this device or build. Use an approved iPhone with the Tap to Pay entitlement enabled.";
  }
  if (lower.includes("location")) {
    return "Stripe Terminal needs a valid location before Tap to Pay can start. Check the shop's Terminal location setup.";
  }
  if (lower.includes("permission")) {
    return "Tap to Pay needs the requested device permissions before it can accept a payment.";
  }
  return message;
}

export function TapToPaySheet({
  visible,
  jobId,
  total,
  onClose,
  onJobPaid,
}: TapToPaySheetProps) {
  const { theme } = useTheme();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [discoveredReaders, setDiscoveredReaders] = useState<Reader.Type[]>([]);
  const [terminalLocationId, setTerminalLocationId] = useState(
    TERMINAL_LOCATION_ID.trim()
  );
  const isConnectingRef = useRef(false);

  const {
    discoverReaders,
    connectReader,
    getLocations,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelDiscovering,
    connectedReader,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: (readers) => {
      setDiscoveredReaders(readers);
    },
  });

  const handleError = useCallback((message: string) => {
    setPhase("error");
    setErrorMessage(getTapToPayErrorMessage(message));
    isConnectingRef.current = false;
  }, []);

  // Bail out if discovery takes too long (missing entitlement, unsupported device, etc.)
  useEffect(() => {
    if (phase !== "discovering") return;
    const timeout = setTimeout(() => {
      handleError("Could not find a Tap to Pay reader. Make sure this is an approved iPhone build with Tap to Pay enabled.");
    }, 20_000);
    return () => clearTimeout(timeout);
  }, [phase, handleError]);

  // When readers are found during discovery, connect immediately
  useEffect(() => {
    if (phase !== "discovering") return;
    if (discoveredReaders.length === 0) return;
    if (isConnectingRef.current) return;

    isConnectingRef.current = true;
    setPhase("connecting");

    if (!terminalLocationId) {
      handleError("Stripe Terminal needs a location before Tap to Pay can start.");
      return;
    }

    connectReader({
      discoveryMethod: "tapToPay",
      reader: discoveredReaders[0],
      locationId: terminalLocationId,
      merchantDisplayName: SHOP_NAME,
      tosAcceptancePermitted: true,
    }).then(({ error }) => {
      isConnectingRef.current = false;
      if (error) {
        handleError(error.message);
      } else {
        setPhase("creating_intent");
      }
    });
  }, [phase, discoveredReaders, terminalLocationId, connectReader, handleError]);

  // When connected, create intent and run the full collection flow
  useEffect(() => {
    if (phase !== "creating_intent") return;

    let cancelled = false;

    (async () => {
      try {
        const res = await api.post<{ clientSecret: string }>(
          `/api/jobs/${jobId}/payments/create-intent`,
          { mode: "terminal" }
        );
        const { clientSecret } = res.data;

        if (cancelled) return;
        const { paymentIntent, error: retrieveError } =
          await retrievePaymentIntent(clientSecret);

        if (cancelled) return;
        if (retrieveError || !paymentIntent) {
          handleError(retrieveError?.message ?? "Payment could not be prepared");
          return;
        }

        setPhase("collecting");

        const { paymentIntent: collected, error: collectError } =
          await collectPaymentMethod({ paymentIntent, skipTipping: true });

        if (cancelled) return;
        if (collectError || !collected) {
          handleError(collectError?.message ?? "Payment was cancelled");
          return;
        }

        setPhase("processing");

        const { error: processError } = await confirmPaymentIntent({
          paymentIntent: collected,
        });

        if (cancelled) return;
        if (processError) {
          handleError(processError.message);
          return;
        }

        setPhase("success");
        onJobPaid();
      } catch (e) {
        if (!cancelled) {
          handleError(e instanceof Error ? e.message : "Payment failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    phase,
    jobId,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    handleError,
    onJobPaid,
  ]);

  const startPayment = useCallback(async () => {
    setErrorMessage(null);
    isConnectingRef.current = false;

    if (Platform.OS !== "ios") {
      handleError("Tap to Pay on iPhone requires an iOS device.");
      return;
    }
    let locationId = TERMINAL_LOCATION_ID.trim() || terminalLocationId;
    if (!locationId) {
      const { locations, error } = await getLocations({ limit: 1 });
      if (error) {
        handleError(error.message);
        return;
      }
      locationId = locations?.[0]?.id ?? "";
    }
    if (!locationId) {
      handleError("Stripe Terminal needs a location before Tap to Pay can start.");
      return;
    }
    setTerminalLocationId(locationId);

    if (connectedReader) {
      // Skip discovery if already connected
      setPhase("creating_intent");
    } else {
      setDiscoveredReaders([]);
      setPhase("discovering");
      const { error } = await discoverReaders({
        discoveryMethod: "tapToPay",
        simulated: false,
      });
      if (error) {
        handleError(error.message);
      }
    }
  }, [connectedReader, discoverReaders, getLocations, handleError, terminalLocationId]);

  const handleClose = useCallback(() => {
    if (phase === "collecting" || phase === "processing") return;
    if (phase === "discovering" || phase === "connecting") {
      cancelDiscovering();
    }
    setPhase("idle");
    setErrorMessage(null);
    setDiscoveredReaders([]);
    isConnectingRef.current = false;
    onClose();
  }, [phase, cancelDiscovering, onClose]);

  const handleDone = useCallback(() => {
    setPhase("idle");
    setErrorMessage(null);
    setDiscoveredReaders([]);
    onClose();
  }, [onClose]);

  const styles = StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: borderRadius["2xl"],
      borderTopRightRadius: borderRadius["2xl"],
      padding: spacing[6],
      paddingBottom: spacing[10],
      gap: spacing[4],
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.surfaceBorder,
      alignSelf: "center",
      marginBottom: spacing[2],
    },
    closeButton: {
      position: "absolute",
      top: spacing[4],
      right: spacing[4],
      padding: spacing[1],
    },
    header: {
      alignItems: "center",
      gap: spacing[2],
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      justifyContent: "center",
      alignItems: "center",
    },
    title: {
      ...fontSize.xl,
      fontWeight: "700",
      color: theme.textHeading,
      textAlign: "center",
    },
    subtitle: {
      ...fontSize.sm,
      color: theme.textSecondary,
      textAlign: "center",
      lineHeight: 20,
    },
    amount: {
      ...fontSize["2xl"],
      fontWeight: "800",
      color: theme.text,
      textAlign: "center",
      fontVariant: ["tabular-nums"],
    },
    errorBox: {
      backgroundColor: colors.red[50],
      borderRadius: borderRadius.lg,
      padding: spacing[3],
      borderWidth: 1,
      borderColor: colors.red[200],
    },
    errorText: {
      ...fontSize.sm,
      color: colors.red[700],
      textAlign: "center",
    },
    actions: {
      gap: spacing[2],
      marginTop: spacing[2],
    },
  });

  const renderContent = () => {
    switch (phase) {
      case "idle":
        return (
          <>
            <View style={styles.header}>
              <View style={[styles.iconCircle, { backgroundColor: colors.emerald[100] }]}>
                <Ionicons name="phone-portrait" size={30} color={colors.emerald[700]} />
              </View>
              <Text style={styles.title}>Tap to Pay</Text>
              <Text style={styles.subtitle}>
                Ask the customer to tap their card or phone on the staff iPhone.
              </Text>
            </View>
            <Text style={styles.amount}>{formatCurrency(total)}</Text>
            <View style={styles.actions}>
              <Button
                title="Start Payment"
                onPress={startPayment}
                variant="primary"
                style={{ backgroundColor: colors.emerald[600] }}
              />
            </View>
          </>
        );

      case "discovering":
      case "connecting":
        return (
          <View style={styles.header}>
            <ActivityIndicator size="large" color={colors.emerald[600]} />
            <Text style={styles.title}>
              {phase === "discovering" ? "Setting up reader…" : "Connecting…"}
            </Text>
            <Text style={styles.subtitle}>This takes just a moment.</Text>
          </View>
        );

      case "creating_intent":
      case "collecting":
        return (
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: colors.blue[50] }]}>
              <Ionicons name="card" size={30} color={colors.blue[600]} />
            </View>
            <Text style={styles.title}>
              {phase === "creating_intent"
                ? "Preparing…"
                : "Hold card near top of iPhone"}
            </Text>
            {phase === "collecting" && (
              <Text style={styles.subtitle}>
                The customer can tap a contactless card, Apple Pay, Google Pay, or another NFC wallet.
              </Text>
            )}
            <Text style={styles.amount}>{formatCurrency(total)}</Text>
            {phase === "collecting" && (
              <ActivityIndicator
                size="small"
                color={theme.textSecondary}
                style={{ marginTop: spacing[2] }}
              />
            )}
          </View>
        );

      case "processing":
        return (
          <View style={styles.header}>
            <ActivityIndicator size="large" color={colors.emerald[600]} />
            <Text style={styles.title}>Processing…</Text>
            <Text style={styles.subtitle}>Do not remove card or close the app.</Text>
          </View>
        );

      case "success":
        return (
          <>
            <View style={styles.header}>
              <View style={[styles.iconCircle, { backgroundColor: colors.emerald[100] }]}>
                <Ionicons name="checkmark-circle" size={36} color={colors.emerald[600]} />
              </View>
              <Text style={styles.title}>Payment complete!</Text>
              <Text style={styles.subtitle}>
                {formatCurrency(total)} collected. The job has been marked as paid.
              </Text>
            </View>
            <View style={styles.actions}>
              <Button title="Done" onPress={handleDone} variant="primary" />
            </View>
          </>
        );

      case "error":
        return (
          <>
            <View style={styles.header}>
              <View style={[styles.iconCircle, { backgroundColor: colors.red[100] }]}>
                <Ionicons name="close-circle" size={36} color={colors.red[500]} />
              </View>
              <Text style={styles.title}>Payment failed</Text>
            </View>
            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
            <View style={styles.actions}>
              <Button title="Try Again" onPress={startPayment} variant="primary" />
              <Button title="Cancel" onPress={handleClose} variant="ghost" />
            </View>
          </>
        );
    }
  };

  const canClose = phase === "idle" || phase === "success" || phase === "error";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={canClose ? handleClose : undefined}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          {canClose && (
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="close" size={22} color={theme.textMuted} />
            </TouchableOpacity>
          )}
          {renderContent()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
