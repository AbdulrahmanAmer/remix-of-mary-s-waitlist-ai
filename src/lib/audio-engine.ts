/**
 * Browser-only audio engine: streamed MARY speech playback (PCM 24k SSE) and
 * microphone capture (PCM -> 16k mono WAV) with live amplitude for visuals.
 * Every export must be called from an effect or event handler, never at import.
 */

let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor({ sampleRate: 24000 });
  }
  return sharedContext;
}

export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Voice shaping — tuned from measurements of the real Mary's own recordings.
 *
 *  measured Mary  : median pitch ~220 Hz, articulation ~4.1 syllables/s, ~1.0 s pauses
 *  base TTS voice : median pitch ~213 Hz, articulation ~5.4 syllables/s (matched conditions)
 *
 * Pitch is already within ~0.6 of a semitone, so only pace is corrected: the audio is
 * time-stretched (pitch preserved) to land near her slower, more relaxed delivery.
 * MARY_PITCH_RATIO retunes playback pitch, MARY_PACE_RATIO sets net speaking speed.
 * Set both to 1 to disable shaping entirely.
 */
const MARY_PITCH_RATIO = 1.0;
const MARY_PACE_RATIO = 0.84;
const MARY_STRETCH = MARY_PITCH_RATIO / MARY_PACE_RATIO;

function hann(n: number) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Streaming WSOLA time stretcher: changes speaking pace without changing pitch.
 * Each analysis frame is nudged to the position that best continues the waveform
 * already written, which keeps voiced speech smooth instead of phasey.
 */
class TimeStretcher {
  private readonly size = 1024;
  private readonly synthHop = 512;
  private readonly overlap = 512;
  private readonly search = 256;
  private readonly analysisHop: number;
  private readonly window: Float32Array;
  private input: Float32Array<ArrayBuffer> = new Float32Array(0);
  private base = 0; // absolute index of input[0]
  private ideal = 0; // absolute ideal read position of the next frame
  private prevRead = -1; // absolute read position of the previous frame
  private acc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private accWin: Float32Array<ArrayBuffer> = new Float32Array(0);
  private emitted = 0;
  private synthPos = 0;

  constructor(stretch: number) {
    this.analysisHop = Math.max(1, Math.round(this.synthHop / stretch));
    this.window = hann(this.size);
  }

  private grow(needed: number) {
    if (this.acc.length >= needed) return;
    const next = new Float32Array(Math.max(needed, this.acc.length * 2 + this.size));
    next.set(this.acc);
    const nextWin = new Float32Array(next.length);
    nextWin.set(this.accWin);
    this.acc = next;
    this.accWin = nextWin;
  }

  /** Finds the read offset whose overlap region best matches the natural continuation. */
  private align(): number {
    if (this.prevRead < 0) return this.ideal;
    const tpl = this.prevRead + this.synthHop - this.base;
    const lo = Math.max(0, this.ideal - this.base - this.search);
    const hi = this.ideal - this.base + this.search;
    if (tpl < 0 || tpl + this.overlap > this.input.length) return this.ideal;
    let bestPos = this.ideal - this.base;
    let bestScore = -Infinity;
    for (let p = lo; p <= hi; p += 4) {
      if (p + this.size > this.input.length) break;
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < this.overlap; i += 2) {
        const a = this.input[tpl + i]!;
        const b = this.input[p + i]!;
        dot += a * b;
        energy += b * b;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        bestPos = p;
      }
    }
    return bestPos + this.base;
  }

  push(chunk: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    const keepFrom = Math.max(0, Math.min(this.ideal, this.prevRead) - this.search - this.size);
    const drop = Math.max(0, keepFrom - this.base);
    const kept = this.input.subarray(Math.min(drop, this.input.length));
    const merged = new Float32Array(kept.length + chunk.length);
    merged.set(kept);
    merged.set(chunk, kept.length);
    this.input = merged;
    this.base += drop;

    while (this.ideal - this.base + this.search + this.size <= this.input.length) {
      const read = this.align();
      const start = read - this.base;
      const offset = this.synthPos - this.emitted;
      this.grow(offset + this.size);
      for (let i = 0; i < this.size; i++) {
        const w = this.window[i]!;
        this.acc[offset + i] = this.acc[offset + i]! + (this.input[start + i] ?? 0) * w;
        this.accWin[offset + i] = this.accWin[offset + i]! + w * w;
      }
      this.prevRead = read;
      this.synthPos += this.synthHop;
      this.ideal += this.analysisHop;
    }

    const safe = this.synthPos - (this.size - this.synthHop) - this.emitted;
    if (safe <= 0) return new Float32Array(0);
    return this.take(safe);
  }

  private take(count: number): Float32Array<ArrayBuffer> {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const w = this.accWin[i]!;
      out[i] = w > 1e-6 ? this.acc[i]! / w : this.acc[i]!;
    }
    this.acc = this.acc.slice(count);
    this.accWin = this.accWin.slice(count);
    this.emitted += count;
    return out;
  }

  flush(): Float32Array<ArrayBuffer> {
    const remaining = this.synthPos - this.emitted;
    return remaining > 0 ? this.take(remaining) : new Float32Array(0);
  }
}

export type SpeakHandle = {
  stop: () => void;
  done: Promise<void>;
};

/** Streams MARY's speech and reports output amplitude (0..1) each frame. */
export function speak(
  text: string,
  opts: {
    onLevel?: (level: number) => void;
    onFirstAudio?: () => void;
    onEnd?: () => void;
  } = {},
): SpeakHandle {
  const ctx = getAudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  analyser.connect(ctx.destination);

  const buffer = new Uint8Array(analyser.frequencyBinCount);
  const sources = new Set<AudioBufferSourceNode>();
  const controller = new AbortController();

  const stretcher = Math.abs(MARY_STRETCH - 1) > 0.001 ? new TimeStretcher(MARY_STRETCH) : null;

  let playhead = 0;
  let pending = new Uint8Array(0);
  let stopped = false;
  let raf = 0;
  let firstAudioFired = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(buffer);
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = Math.abs(buffer[i]! - 128) / 128;
      if (v > peak) peak = v;
    }
    opts.onLevel?.(Math.min(1, peak * 1.6));
    raf = requestAnimationFrame(tick);
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    opts.onLevel?.(0);
    opts.onEnd?.();
    try {
      analyser.disconnect();
    } catch {
      /* already disconnected */
    }
    resolveDone();
  };

  const stop = () => {
    controller.abort();
    for (const src of sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    sources.clear();
    finish();
  };

  const schedule = (floats: Float32Array<ArrayBuffer>) => {
    if (floats.length === 0) return;
    const audioBuffer = ctx.createBuffer(1, floats.length, 24000);
    audioBuffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = MARY_PITCH_RATIO;
    source.connect(analyser);
    if (playhead === 0) playhead = ctx.currentTime + 0.08;
    else playhead = Math.max(playhead, ctx.currentTime);
    source.start(playhead);
    playhead += audioBuffer.duration / MARY_PITCH_RATIO;
    sources.add(source);
    source.onended = () => sources.delete(source);
    if (!firstAudioFired) {
      firstAudioFired = true;
      opts.onFirstAudio?.();
    }
  };

  const enqueue = (incoming: Uint8Array) => {
    const merged = new Uint8Array(pending.length + incoming.length);
    merged.set(pending);
    merged.set(incoming, pending.length);
    const usable = merged.length - (merged.length % 2);
    pending = merged.slice(usable);
    if (usable === 0) return;

    const samples = new Int16Array(merged.buffer, 0, usable / 2);
    const floats = Float32Array.from(samples, (s) => s / 32768);
    schedule(stretcher ? stretcher.push(floats) : floats);
  };

  (async () => {
    await unlockAudio();
    raf = requestAnimationFrame(tick);
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`speech ${res.status}`);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let bufferText = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        bufferText += value;
        const parts = bufferText.split("\n\n");
        bufferText = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payloadText = line.slice(5).trim();
            if (!payloadText || payloadText === "[DONE]") continue;
            try {
              const payload = JSON.parse(payloadText) as {
                type?: string;
                audio?: string;
              };
              if (payload.type === "speech.audio.delta" && payload.audio) {
                enqueue(base64ToBytes(payload.audio));
              }
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      }
      if (stretcher && !stopped) schedule(stretcher.flush());
      const tail = Math.max(0, playhead - ctx.currentTime) * 1000 + 120;
      await new Promise((r) => setTimeout(r, tail));
      finish();
    } catch {
      finish();
    }
  })();

  return { stop, done };
}

export type Recorder = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

export type RecordingOptions = {
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  onSilence?: () => void;
  onMaxDuration?: () => void;
  silenceMs?: number;
  maxDurationMs?: number;
};

/** Captures mic PCM, detects a completed utterance, and returns a 16k mono WAV blob. */
export async function startRecording(options: RecordingOptions = {}): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const startedAt = performance.now();
  const calibrationMs = 550;
  const silenceMs = options.silenceMs ?? 1050;
  const maxDurationMs = options.maxDurationMs ?? 45000;
  let noiseFloor = 0.008;
  let speechCandidateAt = 0;
  let lastSpeechAt = 0;
  let speechDetected = false;
  let completionFired = false;
  let active = true;
  let raf = 0;
  const tick = () => {
    if (!active) return;
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]! - 128) / 128;
      if (v > peak) peak = v;
    }
    const now = performance.now();
    const elapsed = now - startedAt;
    options.onLevel?.(Math.min(1, peak * 1.8));

    if (elapsed < calibrationMs) {
      noiseFloor = noiseFloor * 0.88 + peak * 0.12;
    } else if (!completionFired) {
      const threshold = Math.min(0.22, Math.max(0.025, noiseFloor * 2.8 + 0.008));
      if (peak >= threshold) {
        if (!speechCandidateAt) speechCandidateAt = now;
        lastSpeechAt = now;
        if (!speechDetected && now - speechCandidateAt >= 140) {
          speechDetected = true;
          options.onSpeechStart?.();
        }
      } else {
        if (!speechDetected) {
          speechCandidateAt = 0;
          noiseFloor = noiseFloor * 0.985 + peak * 0.015;
        } else if (now - lastSpeechAt >= silenceMs) {
          completionFired = true;
          options.onSilence?.();
        }
      }

      if (elapsed >= maxDurationMs) {
        completionFired = true;
        options.onMaxDuration?.();
      }
    }
    if (active) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const teardown = () => {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    options.onLevel?.(0);
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
      analyser.disconnect();
      source.disconnect();
    } catch {
      /* noop */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    cancel: () => {
      teardown();
      void ctx.close().catch(() => {});
    },
    stop: async () => {
      teardown();
      const rate = ctx.sampleRate;
      await ctx.close().catch(() => {});
      return encodeWav(chunks, rate);
    },
  };
}

function encodeWav(chunks: Float32Array[], sampleRate: number, target = 16000) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const ratio = sampleRate / target;
  const outLength = Math.max(1, Math.floor(merged.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const sample = merged[Math.floor(i * ratio)] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytes = new ArrayBuffer(44 + out.length * 2);
  const view = new DataView(bytes);
  const writeString = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + out.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, target, true);
  view.setUint32(28, target * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, out.length * 2, true);
  new Int16Array(bytes, 44).set(out);
  return new Blob([bytes], { type: "audio/wav" });
}

export async function transcribe(blob: Blob): Promise<string> {
  if (blob.size < 2048) return "";
  const form = new FormData();
  form.append("file", blob, "recording.wav");
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) return "";
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
