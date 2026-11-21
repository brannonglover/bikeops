import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
} from "react-native";
import { api, ApiError } from "@/lib/api";
import { formatPhoneNumber, unformatPhoneNumber } from "@/lib/format";
import { colors, fontSize, borderRadius, spacing } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import type { Customer } from "@/lib/types";
import { BottomSheetModal } from "@/components/ui/BottomSheetModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Suggestion = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Numbers mentioned in the thread that differ from the one they texted from. */
  mentionedPhones: string[];
};

type PossibleDuplicate = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
};

type ContactPayload = {
  customer: Customer;
  suggestion: Suggestion;
  possibleDuplicate: PossibleDuplicate | null;
};

/** Names the fields the thread supplied, so staff know what to double-check. */
function describeFound(suggestion: Suggestion): string | null {
  const found = [
    suggestion.firstName ? "name" : null,
    suggestion.email ? "email" : null,
    suggestion.mentionedPhones.length > 0 ? "phone number" : null,
  ].filter(Boolean) as string[];
  if (found.length === 0) return null;
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}

/**
 * Fills in a contact auto-created to hold a text from an unknown number,
 * pre-filled with the name, email and any numbers found in the thread itself.
 */
export function CreateContactSheet({
  visible,
  conversationId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  conversationId: string;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [duplicate, setDuplicate] = useState<PossibleDuplicate | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  // Phone state holds bare digits, like the other staff customer forms.
  const [phone, setPhone] = useState("");
  const [initialPhone, setInitialPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<ContactPayload>(`/api/conversations/${conversationId}/contact`)
      .then(({ data }) => {
        if (cancelled) return;
        setSuggestion(data.suggestion);
        setDuplicate(data.possibleDuplicate ?? null);
        // The placeholder name is the phone number itself, so it is never
        // carried into the form — only a real name found in the thread is.
        setFirstName(data.suggestion.firstName ?? "");
        setLastName(data.suggestion.lastName ?? "");
        setEmail(data.suggestion.email ?? data.customer.email ?? "");
        const digits = unformatPhoneNumber(data.customer.phone ?? "");
        setPhone(digits);
        setInitialPhone(digits);
        setAddress(data.customer.address ?? "");
        setNotes(data.customer.notes ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("Could not read this conversation");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, visible]);

  const handleSave = useCallback(async () => {
    if (saving || !firstName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // An untouched phone field is left out of the payload entirely. The
      // stored number is already correct — the number they texted from — and
      // round-tripping it through the US-centric input formatting would
      // rewrite anything outside the North American numbering plan.
      const { data } = await api.post<Customer>(
        `/api/conversations/${conversationId}/contact`,
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          address: address.trim(),
          notes: notes.trim(),
          ...(phone === initialPhone ? {} : { phone }),
        }
      );
      onSaved(data);
    } catch (e: unknown) {
      const message =
        e instanceof ApiError
          ? ((e.data as { error?: string } | undefined)?.error ?? null)
          : null;
      setError(message ?? "Could not save this contact");
    } finally {
      setSaving(false);
    }
  }, [
    address,
    conversationId,
    email,
    firstName,
    initialPhone,
    lastName,
    notes,
    onSaved,
    phone,
    saving,
  ]);

  const foundLabel = suggestion ? describeFound(suggestion) : null;
  const duplicateName = duplicate
    ? [duplicate.firstName, duplicate.lastName].filter(Boolean).join(" ")
    : null;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: {
          paddingHorizontal: spacing[4],
          paddingTop: spacing[3],
          gap: spacing[3],
        },
        hint: {
          ...fontSize.sm,
          color: theme.textSecondary,
        },
        footnote: {
          ...fontSize.xs,
          color: theme.textMuted,
        },
        duplicate: {
          borderWidth: 1,
          borderColor: colors.amber[theme.dark ? 700 : 200],
          backgroundColor: theme.dark
            ? colors.amber[800] + "55"
            : colors.amber[50],
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          gap: spacing[1],
        },
        duplicateText: {
          ...fontSize.sm,
          color: colors.amber[theme.dark ? 400 : 700],
        },
        chip: {
          alignSelf: "flex-start",
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          borderRadius: borderRadius.full,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
        },
        chipText: {
          ...fontSize.xs,
          fontWeight: "600",
          color: theme.text,
        },
        error: {
          ...fontSize.sm,
          color: colors.red[600],
        },
        row: {
          flexDirection: "row",
          gap: spacing[3],
        },
        rowItem: {
          flex: 1,
        },
      }),
    [theme]
  );

  return (
    <BottomSheetModal
      visible={visible}
      title="Create contact"
      onClose={onClose}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          {loading
            ? "Reading the conversation…"
            : foundLabel
              ? `Found ${foundLabel} in this conversation — check before saving.`
              : "Nothing to go on in this conversation yet — fill in what you know."}
        </Text>

        {duplicate ? (
          <View style={styles.duplicate}>
            <Text style={styles.duplicateText}>
              {duplicateName || "An existing contact"} already uses{" "}
              {duplicate.email}. If this is them, add this number to their
              profile instead of creating a second contact.
            </Text>
          </View>
        ) : null}

        <View style={styles.row}>
          <Input
            label="First Name"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            editable={!loading}
            containerStyle={styles.rowItem}
          />
          <Input
            label="Last Name"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            editable={!loading}
            containerStyle={styles.rowItem}
          />
        </View>

        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!loading}
        />

        <Input
          label="Phone"
          value={formatPhoneNumber(phone)}
          onChangeText={(text) => setPhone(unformatPhoneNumber(text))}
          keyboardType="phone-pad"
          editable={!loading}
        />
        <Text style={styles.footnote}>
          Texts are sent to this number — it is the one they messaged from.
        </Text>

        {suggestion?.mentionedPhones.map((mentioned) => (
          <TouchableOpacity
            key={mentioned}
            style={styles.chip}
            onPress={() => setPhone(unformatPhoneNumber(mentioned))}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>
              Also mentioned: {formatPhoneNumber(mentioned)} — use this
            </Text>
          </TouchableOpacity>
        ))}

        <Input
          label="Address"
          value={address}
          onChangeText={setAddress}
          editable={!loading}
        />

        <Input
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={2}
          editable={!loading}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Save contact"
          onPress={handleSave}
          loading={saving}
          disabled={loading || !firstName.trim()}
        />
      </ScrollView>
    </BottomSheetModal>
  );
}
