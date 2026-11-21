import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { ApiError, resolveUrl } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
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
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: savedUrl,
    isLoading,
    isError,
    error: loadError,
  } = useQuery({
    queryKey: greetingQueryKey,
    queryFn: fetchVoicemailGreeting,
    staleTime: 30_000,
    retry: false,
  });

  const elapsed = recorderState.durationMillis / 1000;

  const stopRecording = useCallback(async () => {
    // Read the length before stopping: the recorder resets its status on stop,
    // so anything polled from recorderState afterwards reads back as zero.
    const captured = recorder.currentTime || recorderState.durationMillis / 1000;
    await recorder.stop();
    setPendingSeconds(captured);
    setPendingUri(recorder.uri ?? null);
  }, [recorder, recorderState.durationMillis]);

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
      setPendingSeconds(0);
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
    if (pendingSeconds < MIN_GREETING_SECONDS) {
      setError("That recording is too short to use as a greeting.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await uploadVoicemailGreeting(pendingUri);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      setPendingUri(null);
      setPendingSeconds(0);
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

  // A 404 means voice is disabled for the shop — a real answer, distinct from
  // a request that simply failed. Collapsing the two would make a dropped
  // connection look like a deliberately unavailable feature.
  if (isError) {
    const voiceDisabled = loadError instanceof ApiError && loadError.status === 404;
    return voiceDisabled ? (
      <EmptyState
        icon="call-outline"
        title="Phone service is off"
        message="Turn on voice for your shop to record a greeting for callers."
      />
    ) : (
      <EmptyState
        icon="alert-circle-outline"
        title="Couldn't load your greeting"
        message={
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Check your connection and try again."
        }
      />
    );
  }

  if (!canRecordGreeting) {
    return (
      <Section>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Recording a greeting isn&apos;t supported on Android yet — its recorder
          can&apos;t produce a format Twilio is able to play. Callers hear the
          default message.
        </Text>
      </Section>
    );
  }

  return (
    <Section>
      {isLoading ? (
        <ActivityIndicator size="small" color={theme.textMuted} />
      ) : (
        <>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {pendingUri
              ? `Listen back (${formatGreetingClock(pendingSeconds)}), then save it — or record again to replace this take.`
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
  const status = useAudioPlayerStatus(player);
  return (
    <PlayButton
      onPress={() => (player.playing ? player.pause() : player.play())}
      label={status.playing ? "Pause" : "Play back"}
    />
  );
}

/**
 * Plays the greeting already on the server. The stored URL is either a direct
 * public blob URL or the unauthenticated /api/blob proxy path — the same URL
 * Twilio itself fetches — so it needs resolving against the API host but no
 * auth headers.
 */
function SavedGreetingPlayer({ url }: { url: string }) {
  const player = useAudioPlayer({ uri: resolveUrl(url) });
  const status = useAudioPlayerStatus(player);

  // Recording leaves the session in play-and-record, which on iOS routes
  // output to the earpiece — playback then sounds like nothing at all unless
  // the phone is held to your ear.
  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  }, []);

  const ready = status.isLoaded && !status.isBuffering;

  return (
    <PlayButton
      onPress={() => (player.playing ? player.pause() : player.play())}
      label={
        status.playing ? "Pause" : ready ? "Play current" : "Loading current…"
      }
      disabled={!ready}
    />
  );
}

function PlayButton({
  onPress,
  label,
  disabled = false,
}: {
  onPress: () => void;
  label: string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const isPause = label === "Pause";
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.playRow,
        { borderColor: theme.surfaceBorder, opacity: disabled ? 0.5 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons
        name={isPause ? "pause" : "play"}
        size={14}
        color={disabled ? theme.textMuted : colors.emerald[600]}
      />
      <Text style={[styles.playLabel, { color: theme.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: theme.surface, borderColor: theme.surfaceBorder },
      ]}
    >
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
