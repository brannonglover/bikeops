import { useEffect } from "react";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";

/**
 * The same file the notification rings with, so a call sounds the same whether
 * the app was already open or a push woke the phone. Whichever voicing it
 * holds, it is one strike group followed by silence out to four seconds, so
 * looping it rings at an even cadence and every seam lands in the silence
 * rather than on a strike.
 */
const RING_SOUND = require("../../assets/sounds/incoming_call.wav");

/**
 * Stop ringing once the caller can no longer be there. The server drops a
 * held caller into voicemail after RING_SECONDS (25s), re-checked only between
 * TwiML documents, so the real hangup lands up to a cadence later. Nothing
 * clears the incoming-call screen on its own when a call times out, so without
 * this cap the phone would ring until someone dismissed it by hand.
 */
const MAX_RING_MS = 32_000;

/**
 * Rings the phone for as long as an inbound call is waiting to be answered.
 *
 * This is the foreground half of the ring: a push that arrives while the app
 * is open is handled in-process and its own sound is suppressed (see
 * setNotificationHandler in lib/notifications), so looping the tone here is
 * what makes a call sound like a call instead of a single chime.
 */
export function useIncomingRing(ringing: boolean): void {
  const player = useAudioPlayer(RING_SOUND);

  useEffect(() => {
    if (!ringing) return;

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        player.pause();
      } catch {
        // The player is released when the provider unmounts, which can beat
        // this cleanup. A stop that lands on a dead player is harmless.
      }
    };

    void (async () => {
      try {
        // A shop phone ringing is the entire point, so it has to be audible
        // with the ringer switch off — respecting silent mode here would
        // reproduce the silence this exists to fix. Only this one field is
        // set: the Twilio SDK owns the audio session once a call connects,
        // and a fuller mode change would fight it.
        await setAudioModeAsync({ playsInSilentMode: true });
      } catch {
        // Worth trying to ring anyway on the session we already have.
      }
      if (stopped) return;

      // Back to the start of the burst: a second call reusing this player
      // would otherwise pick up wherever the last one was cut off, which lands
      // mid-silence more often than not. Kept apart from play() below so a
      // refused seek costs the caller the first moment of the ring rather than
      // the whole of it.
      try {
        await player.seekTo(0);
      } catch {
        // Starting mid-cadence still rings.
      }
      if (stopped) return;

      try {
        player.loop = true;
        player.volume = 1;
        player.play();
      } catch (error) {
        console.warn("[call] could not play the incoming ring:", error);
      }
    })();

    const timer = setTimeout(stop, MAX_RING_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [ringing, player]);
}
