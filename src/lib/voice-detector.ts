/**
 * Voice activity detection the way live-call software does it.
 *
 * Loudness alone cannot tell a person from a room: a fan, a projector, traffic
 * or a conference hall full of chatter all cross a volume line. What separates
 * a voice is its *shape* — most of its energy sits in the speech band, it is
 * peaky rather than flat, and it rises clearly above the room as the room is
 * continuously re-learned.
 *
 * This runs off the existing analyser node, frame by frame, and returns a
 * single 0..1 "does this sound like a person" score plus the parts that made
 * it, so the sound check can show what the microphone is actually hearing.
 */

export type VoiceReading = {
  /** 0..1: how much this frame looks like a human voice. */
  score: number;
  /** Speech-band level above the learned room, in dB. */
  snrDb: number;
  /** 0..1: low is tonal (voice), high is flat (hiss, hum, fans). */
  flatness: number;
  /** Speech-band energy against the whole spectrum. Voices are > 1. */
  bandRatio: number;
  /** The learned room level in the speech band, in dB. */
  floorDb: number;
};

const SPEECH_LOW_HZ = 300;
const SPEECH_HIGH_HZ = 3400;
const FULL_LOW_HZ = 80;
const FULL_HIGH_HZ = 8000;

/** Analyser byte values map linearly onto this dB window. */
const MIN_DB = -100;
const DB_RANGE = 70;

const EPS = 1e-12;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class VoiceDetector {
  /** Per-bin room profile, in linear power. Re-learned all through the call. */
  private floor: Float32Array | null = null;
  private smoothed = 0;
  private lastReading: VoiceReading = {
    score: 0,
    snrDb: 0,
    flatness: 1,
    bandRatio: 0,
    floorDb: MIN_DB,
  };

  reset() {
    this.floor = null;
    this.smoothed = 0;
  }

  get reading(): VoiceReading {
    return this.lastReading;
  }

  /**
   * @param spectrum  Output of `analyser.getByteFrequencyData`.
   * @param sampleRate Context sample rate.
   * @param fftSize   Analyser fft size (spectrum.length is fftSize / 2).
   * @param learn     True when this frame may be folded into the room profile
   *                  (nobody talking, nothing playing).
   */
  update(spectrum: Uint8Array, sampleRate: number, fftSize: number, learn: boolean): VoiceReading {
    const bins = spectrum.length;
    if (!bins) return this.lastReading;
    if (!this.floor || this.floor.length !== bins) {
      this.floor = new Float32Array(bins).fill(1e-8);
    }
    const floor = this.floor;
    const binHz = sampleRate / fftSize;
    const idx = (hz: number) => Math.max(0, Math.min(bins - 1, Math.round(hz / binHz)));
    const sLow = idx(SPEECH_LOW_HZ);
    const sHigh = idx(SPEECH_HIGH_HZ);
    const fLow = idx(FULL_LOW_HZ);
    const fHigh = idx(FULL_HIGH_HZ);

    let speechPower = 0;
    let speechFloor = 0;
    let speechBins = 0;
    let logSum = 0;
    let fullPower = 0;
    let fullBins = 0;

    for (let i = fLow; i <= fHigh; i++) {
      const db = MIN_DB + (spectrum[i]! / 255) * DB_RANGE;
      const power = Math.pow(10, db / 10);
      fullPower += power;
      fullBins += 1;

      // The room adapts down fast (a lorry passes, the hall goes quiet) and up
      // slowly, and only climbs at all on frames nobody is speaking through.
      const known = floor[i]!;
      if (power < known) floor[i] = known * 0.85 + power * 0.15;
      else if (learn) floor[i] = known * 0.995 + power * 0.005;

      if (i >= sLow && i <= sHigh) {
        speechPower += power;
        speechFloor += floor[i]!;
        speechBins += 1;
        logSum += Math.log(power + EPS);
      }
    }

    if (!speechBins || !fullBins) return this.lastReading;

    const speechMean = speechPower / speechBins;
    const fullMean = fullPower / fullBins;
    const floorMean = speechFloor / speechBins;

    const snrDb = 10 * Math.log10((speechMean + EPS) / (floorMean + EPS));
    const geometric = Math.exp(logSum / speechBins);
    const flatness = clamp01(geometric / (speechMean + EPS));
    const bandRatio = speechMean / (fullMean + EPS);

    // Speech is 6 dB or more over the room; below 4 dB it is the room itself.
    const snrScore = clamp01((snrDb - 4) / 9);
    // A voice pushes the speech band well above the rest of the spectrum;
    // rumble, hum and handling noise do the opposite.
    const ratioScore = clamp01((bandRatio - 0.85) / 1.4);
    // Harmonics make a voice peaky. Hiss, fans and air conditioning are flat.
    const flatScore = clamp01((0.55 - flatness) / 0.35);

    const raw = 0.55 * snrScore + 0.25 * ratioScore + 0.2 * flatScore;
    // Syllables dip; a short smoothing window keeps a word from flickering
    // apart without letting a single bang look like a sentence.
    this.smoothed = this.smoothed * 0.55 + raw * 0.45;

    this.lastReading = {
      score: clamp01(this.smoothed),
      snrDb,
      flatness,
      bandRatio,
      floorDb: 10 * Math.log10(floorMean + EPS),
    };
    return this.lastReading;
  }
}

/** A frame this voice-like may open a turn. */
export const VOICE_ONSET = 0.5;
/** A frame this voice-like keeps a turn alive. */
export const VOICE_KEEP = 0.32;
/** Cutting in over her needs to look clearly like a person, not a clatter. */
export const VOICE_INTERRUPT = 0.58;

/**
 * Near-field model: the person on the microphone against the voices around them.
 *
 * Voice shape alone cannot do this — everyone in a conference hall has a human
 * voice. What separates the person holding the device is distance: their mouth
 * is centimetres from the microphone and everybody else is metres away, which
 * on a single omnidirectional microphone is worth many dB. So the model keeps
 * two levels: how loud this person is when they really speak to her, and how
 * loud the voice-shaped sound that never becomes a turn is. Speech has to sit
 * near the first and clearly above the second.
 */
export class NearFieldModel {
  /** Typical peak of confirmed, addressed-to-her speech. */
  private own = 0;
  /** Typical peak of voice-shaped sound that never became a turn. */
  private ambient = 0;
  private confirmations = 0;

  reset() {
    this.own = 0;
    this.ambient = 0;
    this.confirmations = 0;
  }

  /** True once enough real turns have been seen to judge by. */
  get trained() {
    return this.confirmations >= 2 && this.own > 0.01;
  }

  get ownLevel() {
    return this.own;
  }

  get ambientLevel() {
    return this.ambient;
  }

  /** A turn that really was this person: their level is now known better. */
  learnOwn(peak: number) {
    if (peak <= 0.005) return;
    this.confirmations += 1;
    // Rises quickly (a new, louder speaker is believed at once) and falls
    // slowly, so one quiet sentence cannot drag the bar down into the room.
    this.own =
      this.own === 0
        ? peak
        : peak > this.own
          ? this.own * 0.6 + peak * 0.4
          : this.own * 0.93 + peak * 0.07;
  }

  /** Voice-shaped sound that turned out not to be them. */
  learnAmbient(peak: number) {
    if (peak <= 0.002) return;
    this.ambient = this.ambient === 0 ? peak : this.ambient * 0.9 + peak * 0.1;
  }

  /** How far this frame sits above the room's own voices, in dB. */
  marginDb(peak: number) {
    const base = Math.max(this.ambient, 0.004);
    return 20 * Math.log10((peak + 1e-6) / base);
  }

  /**
   * Could this frame be the person on the microphone?
   *
   * @param marginDb How far above the room's voices a frame must sit.
   */
  isNearField(peak: number, marginDb: number) {
    if (this.ambient > 0 && this.marginDb(peak) < marginDb) return false;
    // Until she has heard them properly, only distance from the room is known.
    if (!this.trained) return true;
    // A person does not suddenly become eight times quieter; anything that far
    // below their known level is somebody else in the room.
    return peak >= this.own * 0.3;
  }
}
