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
    /** Playback progress 0..1, paced by the actual audio clock. */
    onProgress?: (progress: number) => void;
    /** Rough expected length in seconds; keeps early progress honest while the stream fills. */
    approxDurationSec?: number;
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

  let playhead = 0;
  let pending = new Uint8Array(0);
  let stopped = false;
  let raf = 0;
  let firstAudioFired = false;
  let startAt = 0;
  let progress = 0;
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

    if (opts.onProgress && startAt > 0) {
      const elapsed = Math.max(0, ctx.currentTime - startAt);
      // Total is whatever is scheduled so far, floored by the rough estimate so
      // the reveal never sprints ahead while the stream is still filling.
      const total = Math.max(playhead - startAt, opts.approxDurationSec ?? 0, 0.25);
      const next = Math.min(0.995, elapsed / total);
      if (next > progress) {
        progress = next;
        opts.onProgress(progress);
      }
    }
    raf = requestAnimationFrame(tick);
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    opts.onLevel?.(0);
    opts.onProgress?.(1);
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
    source.connect(analyser);
    if (playhead === 0) {
      playhead = ctx.currentTime + 0.08;
      startAt = playhead;
    } else playhead = Math.max(playhead, ctx.currentTime);
    source.start(playhead);
    playhead += audioBuffer.duration;
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
    schedule(floats);
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
      const tail = Math.max(0, playhead - ctx.currentTime) * 1000 + 120;
      await new Promise((r) => setTimeout(r, tail));
      finish();
    } catch {
      finish();
    }
  })();

  return { stop, done };
}

/**
 * A single always-open microphone line for the whole conversation.
 * One getUserMedia, one audio graph, one speech-recognition stream. Utterances
 * are cut out of the continuous stream by silence, so nothing is torn down and
 * rebuilt between turns and no words are lost at the seams.
 */
export type MicSession = {
  /** Silences capture without releasing the device (no permission re-prompt). */
  setMuted: (muted: boolean) => void;
  /** While MARY speaks, raise the bar so only a real interruption counts. */
  setEchoGuard: (guarding: boolean) => void;
  close: () => void;
};

export type MicSessionOptions = {
  onLevel?: (level: number) => void;
  /** Fires the moment you start talking — used to cut MARY off mid-sentence. */
  onSpeechStart?: () => void;
  /** Live caption of the utterance in progress. */
  onInterim?: (text: string) => void;
  /** A complete utterance: live caption text plus its audio as a fallback. */
  onUtterance: (utterance: { text: string; audio: Blob | null }) => void;
  silenceMs?: number;
  maxUtteranceMs?: number;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [key: number]: { isFinal: boolean; 0: { transcript: string } };
  };
};

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export async function startMicSession(options: MicSessionOptions): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  let chunks: Float32Array[] = [];
  let capturing = false;
  processor.onaudioprocess = (event) => {
    if (!capturing) return;
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  // ---- one recognition stream, owned by the session ----
  // Only results from `resultIndex` onward belong to the current utterance, so
  // the previous sentence can never be re-sent glued to this one.
  let committed = "";
  let interim = "";
  let recognition: Recognition | null = null;
  let recognitionRunning = false;
  let alive = true;

  const startRecognition = () => {
    if (recognition || !alive) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    try {
      const instance = new Ctor();
      instance.continuous = true;
      instance.interimResults = true;
      instance.lang = "en-US";
      instance.onresult = (event) => {
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const text = result[0].transcript;
          if (result.isFinal) committed = `${committed} ${text}`.trim();
          else live += text;
        }
        interim = live.trim();
        options.onInterim?.(`${committed} ${interim}`.trim());
      };
      instance.onend = () => {
        recognitionRunning = false;
        // Browsers end the stream on their own schedule; bring it straight back
        // so the line never goes deaf mid-conversation.
        if (alive && !muted) {
          try {
            instance.start();
            recognitionRunning = true;
          } catch {
            /* already starting */
          }
        }
      };
      instance.onerror = () => {
        recognitionRunning = false;
      };
      instance.start();
      recognitionRunning = true;
      recognition = instance;
    } catch {
      recognition = null;
    }
  };

  const stopRecognition = () => {
    const instance = recognition;
    recognition = null;
    recognitionRunning = false;
    if (!instance) return;
    instance.onresult = null;
    instance.onend = null;
    instance.onerror = null;
    try {
      instance.abort();
    } catch {
      /* already stopped */
    }
  };

  const takeText = () => {
    const text = `${committed} ${interim}`.trim();
    committed = "";
    interim = "";
    return text;
  };

  // ---- voice activity detection over the live stream ----
  const data = new Uint8Array(analyser.frequencyBinCount);
  const silenceMs = options.silenceMs ?? 900;
  const maxUtteranceMs = options.maxUtteranceMs ?? 45000;
  const openedAt = performance.now();
  const calibrationMs = 500;
  let noiseFloor = 0.008;
  let muted = false;
  let echoGuard = false;
  let speechCandidateAt = 0;
  let lastSpeechAt = 0;
  let utteranceStartedAt = 0;
  let raf = 0;

  const flush = () => {
    const audio = chunks.length ? encodeWav(chunks, ctx.sampleRate) : null;
    chunks = [];
    capturing = false;
    speechCandidateAt = 0;
    utteranceStartedAt = 0;
    const text = takeText();
    options.onUtterance({ text, audio });
  };

  const tick = () => {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]! - 128) / 128;
      if (v > peak) peak = v;
    }
    const now = performance.now();
    if (muted) {
      options.onLevel?.(0);
      return;
    }
    options.onLevel?.(Math.min(1, peak * 1.8));

    if (now - openedAt < calibrationMs) {
      noiseFloor = noiseFloor * 0.88 + peak * 0.12;
      return;
    }

    const scale = echoGuard ? 2.4 : 1;
    const threshold = Math.min(0.3, Math.max(0.025, noiseFloor * 2.8 + 0.008) * scale);

    if (peak >= threshold) {
      if (!speechCandidateAt) speechCandidateAt = now;
      lastSpeechAt = now;
      if (!capturing && now - speechCandidateAt >= 140) {
        capturing = true;
        utteranceStartedAt = now;
        chunks = [];
        options.onSpeechStart?.();
      }
    } else if (!capturing) {
      speechCandidateAt = 0;
      noiseFloor = noiseFloor * 0.985 + peak * 0.015;
    } else if (now - lastSpeechAt >= silenceMs) {
      flush();
    }

    if (capturing && now - utteranceStartedAt >= maxUtteranceMs) flush();
  };

  raf = requestAnimationFrame(tick);
  startRecognition();

  return {
    setMuted: (next: boolean) => {
      if (muted === next) return;
      muted = next;
      capturing = false;
      chunks = [];
      speechCandidateAt = 0;
      committed = "";
      interim = "";
      options.onLevel?.(0);
      if (next) stopRecognition();
      else startRecognition();
    },
    setEchoGuard: (guarding: boolean) => {
      echoGuard = guarding;
      if (!recognitionRunning && !muted) startRecognition();
    },
    close: () => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      stopRecognition();
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
        analyser.disconnect();
        source.disconnect();
      } catch {
        /* noop */
      }
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close().catch(() => {});
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
