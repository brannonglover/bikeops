import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { DialPad } from "@/components/calls/DialPad";
import { useCall } from "@/lib/CallContext";
import { useTheme } from "@/lib/ThemeContext";
import { api } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { customerName, formatPhoneNumber, unformatPhoneNumber } from "@/lib/format";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";

/**
 * Builds the number to hand Twilio. The backend dials PSTN, which wants
 * E.164 — a bare 10-digit local number needs the country code prepended, and
 * anything already starting with + is passed through untouched.
 */
function toE164(entry: string): string | null {
  if (entry.startsWith("+")) {
    const rest = unformatPhoneNumber(entry);
    return rest.length >= 8 ? `+${rest}` : null;
  }
  const digits = unformatPhoneNumber(entry);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** What to show in the big readout — formatted for NANP, raw otherwise. */
function displayEntry(entry: string): string {
  if (entry.startsWith("+") || /[*#]/.test(entry)) return entry;
  return formatPhoneNumber(entry);
}

export default function DialScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { startCall, registration } = useCall();
  const [entry, setEntry] = useState("");

  const dialable = useMemo(() => toE164(entry), [entry]);
  const digits = unformatPhoneNumber(entry);

  // Matching customers as the number is typed, so dialing a regular shows who
  // it is before the call connects rather than after.
  const { data: matches = [] } = useQuery({
    queryKey: ["dial-matches", digits],
    enabled: digits.length >= 3,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<Customer[]>(
        `/api/customers?q=${encodeURIComponent(digits)}`
      );
      // The endpoint also matches names and emails; on a keypad only phone
      // matches make sense.
      return data
        .filter((c) => unformatPhoneNumber(c.phone ?? "").includes(digits))
        .slice(0, 3);
    },
  });

  const append = useCallback((digit: string) => {
    setEntry((prev) => (prev.length >= 18 ? prev : prev + digit));
  }, []);

  const backspace = useCallback(() => {
    setEntry((prev) => prev.slice(0, -1));
  }, []);

  const dial = useCallback(
    (number: string, name?: string) => {
      void startCall(number, name);
      setEntry("");
    },
    [startCall]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {registration.status === "failed" ? (
        // Dialing out still works, but a device with notifications off will
        // never ring for the callback — worth saying before the call goes out.
        <View style={[styles.warningBanner, { backgroundColor: colors.amber[600] }]}>
          <Ionicons name="warning-outline" size={16} color={colors.white} />
          <Text style={styles.warningText} numberOfLines={2}>
            Notifications are off — callbacks won&apos;t ring this device
          </Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.readout}>
          <Text
            style={[styles.entry, { color: theme.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            accessibilityLabel={entry ? `Dialing ${displayEntry(entry)}` : "No number entered"}
          >
            {displayEntry(entry) || " "}
          </Text>
          {entry ? (
            <TouchableOpacity
              onPress={backspace}
              onLongPress={() => setEntry("")}
              hitSlop={12}
              style={styles.backspace}
              accessibilityRole="button"
              accessibilityLabel="Delete last digit"
            >
              <Ionicons name="backspace-outline" size={26} color={theme.textMuted} />
            </TouchableOpacity>
          ) : (
            <Text style={[styles.hint, { color: theme.textMuted }]}>
              Enter a number to call
            </Text>
          )}
        </View>

        {matches.length > 0 ? (
          <View style={styles.matches}>
            {matches.map((customer) => (
              <Pressable
                key={customer.id}
                onPress={() =>
                  customer.phone
                    ? dial(
                        toE164(customer.phone) ?? customer.phone,
                        customerName(customer)
                      )
                    : undefined
                }
                style={[
                  styles.match,
                  { backgroundColor: theme.surface, borderColor: theme.surfaceBorder },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Call ${customerName(customer)}`}
              >
                <Ionicons name="person" size={16} color={theme.textMuted} />
                <View style={styles.matchText}>
                  <Text style={[styles.matchName, { color: theme.text }]} numberOfLines={1}>
                    {customerName(customer)}
                  </Text>
                  <Text style={[styles.matchNumber, { color: theme.textSecondary }]}>
                    {formatPhoneNumber(customer.phone ?? "")}
                  </Text>
                </View>
                <Ionicons name="call" size={16} color={colors.emerald[600]} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <DialPad onPress={append} onLongPressZero={() => append("+")} />

        <View style={styles.callRow}>
          <TouchableOpacity
            onPress={() => (dialable ? dial(dialable) : undefined)}
            disabled={!dialable}
            style={[
              styles.callButton,
              {
                backgroundColor: dialable ? colors.emerald[600] : theme.surfaceBorder,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Call"
            accessibilityState={{ disabled: !dialable }}
          >
            <Ionicons
              name="call"
              size={30}
              color={dialable ? colors.white : theme.textMuted}
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeLink}
          accessibilityRole="button"
        >
          <Text style={[styles.closeText, { color: theme.textSecondary }]}>
            Back to call log
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flexGrow: 1,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[8],
    gap: spacing[5],
    justifyContent: "center",
  },
  readout: { alignItems: "center", gap: spacing[2], minHeight: 84 },
  entry: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: "500",
    letterSpacing: 1,
    textAlign: "center",
  },
  hint: { ...fontSize.sm },
  backspace: { padding: spacing[1] },
  matches: { gap: spacing[2], maxWidth: 360, width: "100%", alignSelf: "center" },
  match: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  matchText: { flex: 1 },
  matchName: { ...fontSize.sm, fontWeight: "600" },
  matchNumber: { ...fontSize.xs },
  callRow: { alignItems: "center" },
  callButton: {
    width: 68,
    height: 68,
    borderRadius: borderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  closeLink: { alignItems: "center", paddingVertical: spacing[2] },
  closeText: { ...fontSize.sm },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  warningText: { ...fontSize.xs, fontWeight: "500", flex: 1, color: colors.white },
});
