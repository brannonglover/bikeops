"""Regenerates ringtone.wav, the ringback staff hear while an outbound call rings.

    python3 assets/sounds/ringback.py

This is not a BikeOps sound and is deliberately not designed like one. It is
the North American ringback tone — 440 Hz and 480 Hz together, two seconds on
and four seconds off — because its whole job is to be indistinguishable from
what the same call would sound like on a desk phone. Staff hearing it should
conclude "it's ringing" without thinking about the app at all. The shop's own
voice is incoming_call.py's business.

The filename is fixed by the Twilio Voice SDK, which looks up exactly
`ringtone.wav`: `R.raw.ringtone` on Android, and
`[[NSBundle mainBundle] pathForResource:@"ringtone" ofType:@"wav"]` on iOS.
Rename it and the SDK logs "Can't find sound file" and rings silently. It
reaches both of those places via the expo-notifications `sounds` array in
app.config.ts, so it ships with a native build and never with an OTA update.

The SDK loops playback (iOS numberOfLoops = -1), so one six-second cadence is
the whole file, and the loop seam lands in the middle of the silence where
nothing can click.

bikeopsco serves an 8 kHz twin of this tone at public/audio/ringback.wav, for
callers holding in the shop queue. That one is played down a phone line, which
band-limits it anyway; this one goes straight to the device's own speaker, so
it is generated at full rate instead of resampled from the telephone version.

Output must stay 16-bit PCM WAV.
"""
import math
import os
import struct
import wave

RATE = 44100
# North American precise ringback: the two tones, the cadence, the period.
TONES_HZ = (440.0, 480.0)
ON_S = 2.0
PERIOD_S = 6.0
# Each tone gets half, so the pair sums to this without clipping.
PEAK = 0.5
# Long enough to kill the click at each edge, short enough to still sound
# like a tone switching on rather than swelling.
FADE_S = 0.01

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ringtone.wav")


def envelope(t: float) -> float:
    """Raised-cosine fade in and out around the two-second burst."""
    if t < 0.0 or t > ON_S:
        return 0.0
    if t < FADE_S:
        return 0.5 - 0.5 * math.cos(math.pi * t / FADE_S)
    if t > ON_S - FADE_S:
        return 0.5 - 0.5 * math.cos(math.pi * (ON_S - t) / FADE_S)
    return 1.0


def render() -> bytes:
    frames = bytearray()
    amplitude = PEAK / len(TONES_HZ)
    for n in range(int(PERIOD_S * RATE)):
        t = n / RATE
        gain = envelope(t)
        sample = 0.0
        if gain:
            for hz in TONES_HZ:
                sample += amplitude * gain * math.sin(2.0 * math.pi * hz * t)
        frames += struct.pack("<h", int(max(-1.0, min(1.0, sample)) * 32767))
    return bytes(frames)


def main() -> None:
    with wave.open(OUT, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(render())
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
