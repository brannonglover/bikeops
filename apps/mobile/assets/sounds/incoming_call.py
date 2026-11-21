"""Regenerates incoming_call.wav, the ring for an inbound shop call.

    python3 assets/sounds/incoming_call.py [voicing]
    python3 assets/sounds/incoming_call.py --list

The sound should belong to this app and to this shop, so it is recognisable
across a workshop before anyone has looked at a screen.

It is additive synthesis of struck partials — fast attack, overtones that each
decay faster than the one below them, which is what makes a struck object sound
struck rather than like a beep. Two knobs are separate on purpose: a TIMBRE is
what is being hit (steel dome, glass, wood), and a voicing is the melody hit on
it. Mixing the two is how the family below is built.

Every file is one strike group followed by silence out to four seconds, so
looping it rings at an even cadence and the loop seam lands in the silence.

Output must stay 16-bit PCM WAV: iOS accepts no compressed format for a
notification sound, and the file is bundled into the binary by the
expo-notifications config plugin (see app.config.ts).
"""
import math
import os
import random
import struct
import sys
import wave

RATE = 44100
LENGTH_S = 4.0
# The voicing currently in incoming_call.wav, and what a bare run reproduces.
SHIPPED = "marimba-twice"
PEAK = 0.72  # of full scale; a struck transient peak sits well above its RMS

# A timbre is the striker noise, the shimmer of a detuned second mode on the
# fundamental, and the partials as (frequency ratio, amplitude, decay seconds).
# Inharmonic ratios read as metal; harmonic ones read as a pitched instrument.

# A small steel dome — a bike bell.
BELL = {
    "strike": 0.22,
    "shimmer": 0.62,
    "partials": [(1.0, 1.0, 1.05), (1.52, 0.52, 0.78), (2.13, 0.36, 0.58),
                 (2.78, 0.24, 0.42), (3.57, 0.14, 0.30)],
}

# Softer and nearly harmonic: a tuned chime rather than a bicycle.
CHIME = {
    "strike": 0.10,
    "shimmer": 0.45,
    "partials": [(1.0, 1.0, 1.30), (2.01, 0.34, 0.60), (3.02, 0.16, 0.36),
                 (5.1, 0.07, 0.22)],
}

# Glass: barely any striker, long decay, high partials that hang on and beat.
GLASS = {
    "strike": 0.04,
    "shimmer": 0.70,
    "partials": [(1.0, 1.0, 1.90), (2.0, 0.30, 0.95), (3.0, 0.13, 0.55),
                 (4.21, 0.08, 0.34), (6.32, 0.04, 0.20)],
}

# Wood: a marimba's 1 : 4 : 10 bar modes, mallet thump, and a fast decay.
WOOD = {
    "strike": 0.30,
    "shimmer": 0.0,
    "partials": [(1.0, 1.0, 0.55), (3.9, 0.26, 0.18), (10.5, 0.06, 0.08)],
}

# Equal temperament, A4 = 440.
A4, Cs5, D5, E5, Fs5 = 440.00, 554.37, 587.33, 659.25, 739.99
A5, Cs6, D6, E6, Fs6, A6 = 880.00, 1108.73, 1174.66, 1318.51, 1479.98, 1760.00


def notes(pitches, timbre, spacing, amps=None):
    """A melody: each pitch struck `spacing` apart, rising in level by default."""
    amps = amps or [0.82 + 0.18 * i / max(len(pitches) - 1, 1) for i in range(len(pitches))]
    return [(i * spacing, f, a, timbre) for i, (f, a) in enumerate(zip(pitches, amps))]


def at(offset_s, voices, level=1.0):
    """The same figure again later in the loop, optionally quieter."""
    return [(start + offset_s, f, amp * level, timbre) for start, f, amp, timbre in voices]


VOICINGS = {
    # --- Bells -------------------------------------------------------------
    # Thumb-lever bike bell: the friendly "ding-ding".
    "double": [(0.00, 2180, 1.00, BELL), (0.30, 2180, 0.82, BELL)],
    # Rotary bell: three fast strikes, more urgent, harder to sleep through.
    "triple": [(0.00, 2400, 1.00, BELL), (0.135, 2400, 0.92, BELL),
               (0.270, 2400, 0.80, BELL)],
    # The triple's strike density at the double's warmer pitch.
    "warm-triple": [(0.00, 2180, 1.00, BELL), (0.135, 2180, 0.92, BELL),
                    (0.270, 2180, 0.80, BELL)],

    # --- Chimes ------------------------------------------------------------
    # The original rising figure: A5–D6–F#6, a fourth then a major third.
    "chime": notes([A5, D6, Fs6], CHIME, 0.20, [0.85, 0.92, 1.00]),
    # Open fifths up to the octave — the most "signature" of the set.
    "fifths": notes([A5, E6, A6], GLASS, 0.22),
    # Four notes of an A major arpeggio, quick. The most melodic.
    "arpeggio": notes([A5, Cs6, E6, A6], CHIME, 0.15),
    # Descending fifth, struck slowly on glass: a doorbell, not an alarm.
    "doorbell": notes([D6, A5], GLASS, 0.42, [1.00, 0.95]),
    # The original motif on glass — same melody, longer and shimmerier.
    "glass": notes([A5, D6, Fs6], GLASS, 0.24, [0.85, 0.92, 1.00]),
    # An octave down on wooden bars: warm, dry, the least piercing option.
    "marimba": notes([A4, D5, Fs5], WOOD, 0.16),
    # What ships. Wood decays fast enough that "marimba" leaves most of the
    # loop silent, which reads as hesitant for a ring; this strikes the figure
    # twice per cadence, the repeat slightly quieter so it lands as an echo of
    # the first rather than as a second event.
    "marimba-twice": (lambda fig: fig + at(1.6, fig, 0.9))(
        notes([A4, D5, Fs5], WOOD, 0.16)
    ),
}


def render(voices):
    """voices: (start_s, f0, amp, timbre)."""
    n = int(LENGTH_S * RATE)
    buf = [0.0] * n
    rng = random.Random(7)  # deterministic, so a rebuild is byte-identical

    for start_s, f0, amp, timbre in voices:
        start = int(start_s * RATE)

        # The striker itself: a few milliseconds of noise for the impact.
        # Without it the note fades in rather than being hit.
        for i in range(int(0.006 * RATE)):
            if start + i >= n:
                break
            decay = math.exp(-i / RATE / 0.0018)
            buf[start + i] += rng.uniform(-1, 1) * timbre["strike"] * amp * decay

        for ratio, p_amp, tau in timbre["partials"]:
            f = f0 * ratio
            if f >= RATE / 2:
                continue
            # Two nearly-equal modes beating against each other are what give a
            # struck object its shimmer, so the fundamental gets a detuned twin.
            twins = [(0.0, 1.0)]
            if ratio == 1.0 and timbre["shimmer"]:
                twins.append((2.7, timbre["shimmer"]))
            for detune, weight in twins:
                w = 2 * math.pi * (f + detune)
                for i in range(int(min(tau * 6, LENGTH_S - start_s) * RATE)):
                    if start + i >= n:
                        break
                    t = i / RATE
                    env = math.exp(-t / tau) * (1 - math.exp(-t / 0.0012))
                    buf[start + i] += math.sin(w * t) * p_amp * weight * amp * env
    return buf


def write(path, buf):
    scale = PEAK / (max(abs(x) for x in buf) or 1.0)
    fade = int(0.03 * RATE)  # so the loop seam never clicks
    frames = []
    for i, x in enumerate(buf):
        gain = min(1.0, (len(buf) - i) / fade) if i > len(buf) - fade else 1.0
        frames.append(int(max(-1.0, min(1.0, x * scale * gain)) * 32767))
    out = wave.open(path, "w")
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(RATE)
    out.writeframes(struct.pack("<%dh" % len(frames), *frames))
    out.close()


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else SHIPPED
    if name in ("--list", "-l"):
        print("\n".join(VOICINGS))
        sys.exit(0)
    if name not in VOICINGS:
        sys.exit(f"unknown voicing {name!r} — try --list")
    here = os.path.dirname(os.path.abspath(__file__))
    write(os.path.join(here, "incoming_call.wav"), render(VOICINGS[name]))
    print(f"wrote incoming_call.wav ({name}, {LENGTH_S}s)")
