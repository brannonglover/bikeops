import { memo, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ThreadCall } from "@/lib/types";
import { useTheme } from "@/lib/ThemeContext";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { formatCallDuration } from "@/lib/calls";
import { formatDateTime, formatTime } from "@/lib/format";

/**
 * A phone call in the staff chat thread: what the caller wanted when the AI
 * assistant answered, a voicemail's transcription, or just that a call
 * happened, so the push that brought staff here has something to show them.
 * Voicemail audio still plays from the Calls tab.
 */

function callHeadline(call: ThreadCall): string {
  if (call.aiAnswered) return "Assistant answered a call";
  if (call.direction === "OUTBOUND") {
    return call.answeredAt ? "Outgoing call" : "Outgoing call · no answer";
  }
  if (call.status === "VOICEMAIL" || call.hasRecording) return "Voicemail";
  if (call.answeredAt) return "Incoming call";
  if (call.status === "IN_PROGRESS") return "Incoming call · in progress";
  if (call.status === "QUEUED" || call.status === "RINGING") return "Incoming call · ringing";
  return "Missed call";
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

type TranscriptLine = { speaker: "Caller" | "Assistant" | null; text: string };

function parseTranscript(transcript: string): TranscriptLine[] {
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(Caller|Assistant):\s*(.*)$/.exec(line);
      return match
        ? { speaker: match[1] as "Caller" | "Assistant", text: match[2] }
        : { speaker: null, text: line };
    });
}

export const ThreadCallCard = memo(function ThreadCallCard({ call }: { call: ThreadCall }) {
  const { theme } = useTheme();
  const [showTranscript, setShowTranscript] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          alignSelf: "stretch",
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.subtleBg,
          borderRadius: borderRadius["2xl"],
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          gap: spacing[2],
        },
        header: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
        headline: { flex: 1, color: theme.text, fontWeight: "600", ...fontSize.sm },
        meta: { color: theme.textSecondary, ...fontSize.xs },
        body: { color: theme.text, ...fontSize.sm },
        muted: { color: theme.textSecondary, ...fontSize.sm, fontStyle: "italic" },
        toggle: {
          color: theme.dark ? colors.emerald[300] : colors.emerald[700],
          ...fontSize.xs,
          fontWeight: "600",
        },
        transcript: {
          borderWidth: 1,
          borderColor: theme.surfaceBorder,
          backgroundColor: theme.surface,
          borderRadius: borderRadius.xl,
          padding: spacing[3],
          gap: spacing[1.5],
        },
        line: { color: theme.textTertiary, ...fontSize.sm },
        caller: { color: theme.text, fontWeight: "600" },
        assistant: {
          color: theme.dark ? colors.emerald[300] : colors.emerald[700],
          fontWeight: "600",
        },
      }),
    [theme]
  );

  const headline = callHeadline(call);
  const missed = headline === "Missed call";
  const duration = formatCallDuration(call.durationSeconds);
  const at = call.startedAt ?? call.createdAt;
  const when = isToday(at) ? formatTime(at) : formatDateTime(at);
  const transcript = useMemo(
    () => (call.aiTranscript ? parseTranscript(call.aiTranscript) : []),
    [call.aiTranscript]
  );
  // The summary is written after the caller hangs up, a few seconds after the
  // call itself ends.
  const summaryPending = call.aiAnswered && !call.aiSummary && !call.endedAt;
  const voicemailText = call.transcriptionText?.trim();
  const voicemailPending =
    call.hasRecording && !voicemailText && call.transcriptionStatus === "in-progress";

  return (
    <View style={styles.card} accessibilityLabel={`${headline}, ${when}`}>
      <View style={styles.header}>
        <Ionicons
          name={missed ? "call-outline" : "call"}
          size={16}
          color={missed ? colors.amber[600] : colors.emerald[600]}
        />
        <Text style={styles.headline} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={styles.meta}>
          {when}
          {duration ? ` · ${duration}` : ""}
        </Text>
      </View>

      {call.aiSummary ? (
        <Text style={styles.body} selectable>
          {call.aiSummary}
        </Text>
      ) : summaryPending ? (
        <Text style={styles.muted}>Summary will appear when the call ends.</Text>
      ) : null}

      {voicemailText ? (
        <Text style={styles.body} selectable>
          “{voicemailText}”
        </Text>
      ) : voicemailPending ? (
        <Text style={styles.muted}>Transcribing voicemail…</Text>
      ) : null}

      {transcript.length > 0 ? (
        <>
          <TouchableOpacity
            onPress={() => setShowTranscript((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showTranscript }}
            hitSlop={8}
          >
            <Text style={styles.toggle}>
              {showTranscript ? "Hide transcript" : "Show transcript"}
            </Text>
          </TouchableOpacity>
          {showTranscript ? (
            <View style={styles.transcript}>
              {transcript.map((line, index) => (
                <Text key={index} style={styles.line} selectable>
                  {line.speaker ? (
                    <Text style={line.speaker === "Caller" ? styles.caller : styles.assistant}>
                      {line.speaker}:{" "}
                    </Text>
                  ) : null}
                  {line.text}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
});
