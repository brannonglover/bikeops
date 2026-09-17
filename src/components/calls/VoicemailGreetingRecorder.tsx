import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { resolveUrl } from "@/lib/api";
import {
  GREETING_RECORDING_OPTIONS,
  MAX_GREETING_SECONDS,
  MIN_GREETING_SECONDS,
  canRecordGreeting,
  deleteVoicemailGreeting,
  fetchVoicemailGreeting,
  formatGreetingClock,
  uploadVoicemailGreeting,
} from "@/lib/voicemail-greeting";

export const greetingQueryKey = ["voicemail-greeting"] as const;

/**
 * Records the greeting callers hear before the beep.
 *
 * Tap Record to start, tap again to stop — the take is held locally so it can
 * be previewed, and only reaches the server on Save. Tapping Record on a held
 * take discards it and starts over, which is the overwrite the shop expects
 * rather than accumulating drafts.
 */
export function VoicemailGreetingRecorder() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const recorder = useAudioRecorder(GREETING_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);

  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: savedUrl,
    isLoading,
    isError,
  } = useQuery({
    queryKey: greetingQueryKey,
    queryFn: fetchVoicemailGreeting,
    staleTime: 30_000,
    retry: false,
  });

  const elapsed = recorderState.durationMillis / 1000;

  const stopRecording = useCallback(async () => {
    await recorder.stop();
    setPendingUri(recorder.uri ?? null);
  }, [recorder]);

  // Hard cap so a forgotten recording can't run past what a caller will sit
  // through — or past what the upload limit allows.
  useEffect(() => {
    if (recorderState.isRecording && elapsed >= MAX_GREETING_SECONDS) {
      void stopRecording();
    }
  }, [recorderState.isRecording, elapsed, stopRecording]);

  const startRecording = async () => {
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("Microphone access is off. Enable it in Settings to record a greeting.");
        return;
      }

      // Without this iOS records through the receiver at low gain and plays
      // preview audio out the earpiece instead of the speaker.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      setPendingUri(null);
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setError("Couldn't start recording.");
    }
  };

  const handleRecordPress = () => {
    if (recorderState.isRecording) {
      void stopRecording();
      return;
    }
    void startRecording();
  };

  const handleSave = async () => {
    if (!pendingUri) return;
    if (elapsed < MIN_GREETING_SECONDS) {
      setError("That recording is too short to use as a greeting.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await uploadVoicemailGreeting(pendingUri);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      setPendingUri(null);
      await queryClient.invalidateQueries({ queryKey: greetingQueryKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the greeting.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      "Remove greeting?",
      "Callers will hear the default message instead.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteVoicemailGreeting();
              await queryClient.invalidateQueries({ queryKey: greetingQueryKey });
            } catch {
              setError("Couldn't remove the greeting.");
            }
          },
        },
      ]
    );
  };

  // The endpoint 404s when voice is disabled for the shop, which is the app's
  // only signal for it — no greeting UI belongs on a shop without phone service.
  if (isError) return null;

  if (!canRecordGreeting) {
    return (
      <Section title="Voicemail greeting">
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Recording a greeting isn&apos;t supported on Android yet — its recorder
          can&apos;t produce a format Twilio is able to play. Callers hear the
          default message.
        </Text>
      </Section>
    );
  }

  return (
    <Section title="Voicemail greeting">
      {isLoading ? (
        <ActivityIndicator size="small" color={theme.textMuted} />
      ) : (
        <>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {pendingUri
              ? "Listen back, then save it — or record again to replace this take."
              : savedUrl
                ? "Callers hear your recorded greeting before the beep."
                : "Callers hear a default message. Record one to use your own voice."}
          </Text>

          {pendingUri ? (
            <PreviewPlayer uri={pendingUri} />
          ) : savedUrl ? (
            <SavedGreetingPlayer url={savedUrl} />
          ) : null}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={handleRecordPress}
              disabled={isSaving}
              style={[
                styles.button,
                {
                  backgroundColor: recorderState.isRecording
                    ? colors.red[600]
                    : colors.slate[700],
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                recorderState.isRecording ? "Stop recording" : "Record greeting"
              }
            >
              <Ionicons
                name={recorderState.isRecording ? "stop" : "mic"}
                size={16}
                color={colors.white}
              />
              <Text style={styles.buttonLabel}>
                {recorderState.isRecording
                  ? `Stop · ${formatGreetingClock(elapsed)}`
                  : pendingUri || savedUrl
                    ? "Record again"
                    : "Record"}
              </Text>
            </TouchableOpacity>

            {pendingUri ? (
              <TouchableOpacity
                onPress={handleSave}
                disabled={isSaving}
                style={[styles.button, { backgroundColor: colors.emerald[600] }]}
                accessibilityRole="button"
                accessibilityLabel="Save greeting"
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Ionicons name="checkmark" size={16} color={colors.white} />
                )}
                <Text style={styles.buttonLabel}>Save</Text>
              </TouchableOpacity>
            ) : savedUrl ? (
              <TouchableOpacity
                onPress={handleDelete}
                style={[styles.button, { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.surfaceBorder }]}
                accessibilityRole="button"
                accessibilityLabel="Remove greeting"
              >
                <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
                <Text style={[styles.buttonLabel, { color: theme.textSecondary }]}>
                  Remove
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {error ? (
            <Text style={[styles.error, { color: colors.red[600] }]}>{error}</Text>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** Plays the unsaved take straight off the local file. */
function PreviewPlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri });
  return <PlayButton onPress={() => (player.playing ? player.pause() : player.play())} label="Play back" />;
}

/**
 * Plays the greeting already on the server. The stored URL is either a direct
 * public blob URL or the unauthenticated /api/blob proxy path — the same URL
 * Twilio itself fetches — so it needs resolving against the API host but no
 * auth headers.
 */
function SavedGreetingPlayer({ url }: { url: string }) {
  const player = useAudioPlayer({ uri: resolveUrl(url) });
  return (
    <PlayButton
      onPress={() => (player.playing ? player.pause() : player.play())}
      label="Play current"
    />
  );
}

function PlayButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.playRow, { borderColor: theme.surfaceBorder }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name="play" size={14} color={colors.emerald[600]} />
      <Text style={[styles.playLabel, { color: theme.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: theme.surface, borderColor: theme.surfaceBorder },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: spacing[4],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    gap: spacing[3],
  },
  title: { ...fontSize.base, fontWeight: "600" },
  body: { ...fontSize.sm, lineHeight: 20 },
  buttonRow: { flexDirection: "row", gap: spacing[2] },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.full,
  },
  buttonLabel: { ...fontSize.sm, fontWeight: "600", color: colors.white },
  playRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  playLabel: { ...fontSize.xs, fontWeight: "600" },
  error: { ...fontSize.xs },
});
