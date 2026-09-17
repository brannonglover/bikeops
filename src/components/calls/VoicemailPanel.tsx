import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
  ActivityIndicator,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer } from "expo-video";
import { getCallRecordingSource } from "@/lib/api";
import { colors, spacing, fontSize, borderRadius } from "@/lib/theme";
import { useTheme } from "@/lib/ThemeContext";
import { formatPlaybackTime, voicemailTranscript } from "@/lib/calls";
import type { Call } from "@/lib/types";

/**
 * Voicemail playback runs through expo-video rather than expo-audio: the
 * native module is already in the build, so this ships as an OTA update
 * instead of waiting on a store release. An audio-only source plays fine
 * without a VideoView mounted.
 */

const SCRUB_HIT_HEIGHT = 28;
const TRACK_HEIGHT = 4;
const KNOB_SIZE = 12;

interface VoicemailPanelProps {
  call: Call;
  onCallBack: () => void;
  onMessage: () => void;
  /** Null for callers who already have a customer record. */
  onAddCustomer: (() => void) | null;
}

export function VoicemailPanel({
  call,
  onCallBack,
  onMessage,
  onAddCustomer,
}: VoicemailPanelProps) {
  const { theme } = useTheme();
  const [sourceFailed, setSourceFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [loadedDuration, setLoadedDuration] = useState(0);
  const [ended, setEnded] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
  });

  /**
   * Twilio reports RecordingDuration in whole seconds, so a 2.6s message
   * arrives as 3. Good enough to fill the readout before the audio loads, but
   * the scrubber has to switch to the real media duration once it's known —
   * against the rounded value the bar stops short of the end and every
   * position-vs-duration comparison is off by up to a second.
   */
  const fallbackDuration = call.durationSeconds ?? 0;
  const duration = loadedDuration > 0 ? loadedDuration : fallbackDuration;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const timeUpdate = useEvent(player, "timeUpdate", null);
  const { status } = useEvent(player, "statusChange", { status: player.status });

  // A 401 from the proxy and an unplayable recording both land here as
  // "error" — either way the message can't play, so they read the same.
  const failed = sourceFailed || status === "error";
  const isLoading = !failed && status !== "readyToPlay";

  useEffect(() => {
    // Ignored once ended: the bar is pinned to the end there, and a late tick
    // carrying a slightly smaller time would pull it backwards.
    if (timeUpdate && !ended) setPosition(timeUpdate.currentTime);
  }, [timeUpdate, ended]);

  useEffect(() => {
    if (status === "readyToPlay" && player.duration > 0) {
      setLoadedDuration(player.duration);
    }
  }, [status, player]);

  // The authoritative end signal. timeUpdate only fires every 250ms, so the
  // last one it emits can sit well short of the true end — that gap is what
  // leaves the bar looking unfinished.
  useEventListener(player, "playToEnd", () => {
    setEnded(true);
    setPosition(durationRef.current);
  });

  // The recording streams from our own API behind the staff session, so the
  // source needs auth headers and can't be handed to the player synchronously.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const source = await getCallRecordingSource(call.id);
        if (cancelled) return;
        await player.replaceAsync(source);
      } catch {
        if (cancelled) return;
        setSourceFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [call.id, player]);

  const trackRef = useRef<View>(null);
  const trackLeft = useRef(0);
  const trackWidth = useRef(0);
  const wasPlayingRef = useRef(false);

  const seekTo = useCallback(
    (seconds: number) => {
      const total = durationRef.current;
      if (total <= 0) return;
      player.currentTime = Math.min(Math.max(seconds, 0), total);
      setPosition(player.currentTime);
      setEnded(false);
    },
    [player]
  );

  /**
   * Absolute page coordinates, not locationX: on a move, locationX is relative
   * to whichever nested view the finger is over (track, fill or knob), which
   * makes the thumb jump as it crosses them.
   */
  const positionFromPageX = useCallback((pageX: number): number => {
    const width = trackWidth.current;
    const total = durationRef.current;
    if (width <= 0 || total <= 0) return 0;
    const offset = Math.min(Math.max(pageX - trackLeft.current, 0), width);
    return (offset / width) * total;
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (_event, gesture) => {
          // Pausing for the drag keeps timeUpdate from fighting the thumb for
          // control of the position.
          wasPlayingRef.current = player.playing;
          if (player.playing) player.pause();
          setScrubPosition(positionFromPageX(gesture.x0));
        },
        onPanResponderMove: (_event, gesture) => {
          setScrubPosition(positionFromPageX(gesture.moveX));
        },
        onPanResponderRelease: (_event, gesture) => {
          // moveX stays 0 for a tap with no movement — fall back to where the
          // finger landed so tapping the bar seeks there.
          const target = positionFromPageX(gesture.moveX || gesture.x0);
          setScrubPosition(null);
          seekTo(target);
          if (wasPlayingRef.current) player.play();
        },
        onPanResponderTerminate: () => setScrubPosition(null),
      }),
    [player, seekTo, positionFromPageX]
  );

  const onTrackLayout = (event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
    // measureInWindow for the page offset — onLayout only reports size and a
    // position relative to the parent, which the gesture can't use.
    trackRef.current?.measureInWindow((x) => {
      trackLeft.current = x;
    });
  };

  const togglePlayback = () => {
    if (failed) return;
    if (player.playing) {
      player.pause();
      return;
    }
    if (ended) {
      // replay() rewinds and starts in one native call. Setting currentTime
      // and then calling play() races against the seek, and a player sitting
      // at the end ignores a bare play() outright.
      setEnded(false);
      setPosition(0);
      player.replay();
      return;
    }
    player.play();
  };

  const shown = scrubPosition ?? position;
  const progress = duration > 0 ? Math.min(shown / duration, 1) : 0;
  const transcript = voicemailTranscript(call);

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.surface, borderTopColor: theme.surfaceBorderSubtle },
      ]}
    >
      <View style={styles.playerRow}>
        <TouchableOpacity
          onPress={togglePlayback}
          disabled={failed}
          style={[
            styles.playButton,
            { backgroundColor: failed ? theme.surfaceBorder : colors.emerald[600] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause voicemail" : "Play voicemail"}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={20}
              color={colors.white}
              // The play glyph is visually left-heavy; nudge it back to centre.
              style={isPlaying ? undefined : styles.playGlyph}
            />
          )}
        </TouchableOpacity>

        <View style={styles.scrubColumn}>
          <View
            ref={trackRef}
            style={styles.scrubHitArea}
            onLayout={onTrackLayout}
            {...panResponder.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="Voicemail position"
            accessibilityValue={{
              min: 0,
              max: Math.round(duration),
              now: Math.round(shown),
            }}
          >
            <View style={[styles.track, { backgroundColor: theme.surfaceBorder }]}>
              <View
                style={[
                  styles.trackFill,
                  { width: `${progress * 100}%`, backgroundColor: colors.emerald[600] },
                ]}
              />
            </View>
            <View
              style={[
                styles.knob,
                {
                  left: `${progress * 100}%`,
                  backgroundColor: colors.emerald[600],
                  borderColor: theme.surface,
                },
              ]}
            />
          </View>

          <View style={styles.timeRow}>
            <Text style={[styles.timeText, { color: theme.textMuted }]}>
              {formatPlaybackTime(shown)}
            </Text>
            <Text style={[styles.timeText, { color: theme.textMuted }]}>
              {formatPlaybackTime(duration)}
            </Text>
          </View>
        </View>
      </View>

      {failed ? (
        <Text style={[styles.transcriptMeta, { color: colors.red[600] }]}>
          Couldn&apos;t load this voicemail.
        </Text>
      ) : null}

      <TranscriptBlock transcript={transcript} />

      <View style={styles.actionRow}>
        <PanelAction icon="call" label="Call back" onPress={onCallBack} tint={colors.emerald[600]} />
        {onAddCustomer ? (
          <PanelAction
            icon="person-add"
            label="Add customer"
            onPress={onAddCustomer}
            tint={colors.amber[600]}
          />
        ) : (
          <PanelAction
            icon="chatbubble-ellipses"
            label="Message"
            onPress={onMessage}
            tint={colors.slate[500]}
          />
        )}
      </View>
    </View>
  );
}

function TranscriptBlock({
  transcript,
}: {
  transcript: ReturnType<typeof voicemailTranscript>;
}) {
  const { theme } = useTheme();

  if (transcript.state === "none") return null;

  if (transcript.state === "pending") {
    return (
      <View style={styles.transcriptPending}>
        <ActivityIndicator size="small" color={theme.textMuted} />
        <Text style={[styles.transcriptMeta, { color: theme.textMuted }]}>
          Transcribing…
        </Text>
      </View>
    );
  }

  if (transcript.state === "failed") {
    return (
      <Text style={[styles.transcriptMeta, { color: theme.textMuted }]}>
        No transcript for this message.
      </Text>
    );
  }

  return (
    <View
      style={[
        styles.transcriptBox,
        { backgroundColor: theme.background, borderColor: theme.surfaceBorderSubtle },
      ]}
    >
      <Text style={[styles.transcriptLabel, { color: theme.textMuted }]}>TRANSCRIPT</Text>
      <Text style={[styles.transcriptText, { color: theme.text }]}>{transcript.text}</Text>
    </View>
  );
}

function PanelAction({
  icon,
  label,
  onPress,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tint: string;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.action, { borderColor: theme.surfaceBorder }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={tint} />
      <Text style={[styles.actionLabel, { color: theme.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    gap: spacing[3],
    borderTopWidth: 1,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  playGlyph: { marginLeft: 2 },
  scrubColumn: { flex: 1, gap: 2 },
  scrubHitArea: {
    height: SCRUB_HIT_HEIGHT,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: "hidden",
  },
  trackFill: { height: TRACK_HEIGHT },
  knob: {
    position: "absolute",
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    borderWidth: 2,
    marginLeft: -KNOB_SIZE / 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timeText: {
    ...fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  transcriptPending: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  transcriptMeta: {
    ...fontSize.xs,
    fontStyle: "italic",
  },
  transcriptBox: {
    padding: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing[1],
  },
  transcriptLabel: {
    ...fontSize.xs,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  transcriptText: {
    ...fontSize.sm,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing[2],
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  actionLabel: {
    ...fontSize.xs,
    fontWeight: "600",
  },
});
