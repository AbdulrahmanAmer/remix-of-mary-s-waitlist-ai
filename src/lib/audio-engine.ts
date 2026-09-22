/**
 * Browser-only audio engine.
 *
 * Playback: MARY's voice streams in as PCM (24k) and is scheduled just-in-time
 * from a cursor, so it can be paused the instant the person starts talking and
 * resumed if it turns out to be her own echo or a passing noise. It is played
 * out through a media element rather than straight into the audio graph, which
 * is the route the browser's echo canceller treats as "our own sound".
 *
 * Capture: one always-open microphone line for the whole call. Utterances are
 * cut from the continuous stream by silence; anything that is really her voice
 * coming back through the room is recognised and thrown away — both by level
 * (a playback-aware echo model) and by words (matching against what she is
 * saying right now).
 *
 * Every export must be called from an effect or event handler, never at import.
 */
import {
  EchoTracker,
  endpointDelayMs,
  isEchoOfAssistant,
  stripAssistantEcho,
  transcriptConfirmsInterrupt,
} from "./voice-logic";

const RATE = 24000;

let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor({ sampleRate: RATE });
  }
  return sharedContext;
}

// ---------------------------------------------------------------------------
// Output sink — her voice leaves through an <audio> element so the browser's
// echo canceller has it as a reference and the mic stops hearing her.
// ---------------------------------------------------------------------------
type Sink = {
  node: MediaStreamAudioDestinationNode;
  element: HTMLAudioElement;
  ready: Promise<boolean>;
  ok: boolean;
};
let sink: Sink | null = null;

function ensureSink(ctx: AudioContext): Sink {
  if (sink) return sink;
  const node = ctx.createMediaStreamDestination();
  const element = document.createElement("audio");
  element.setAttribute("playsinline", "");
  element.autoplay = true;
  element.srcObject = node.stream;
  const created: Sink = { node, element, ok: false, ready: Promise.resolve(false) };
  created.ready = element
    .play()
    .then(() => {
      created.ok = true;
      return true;
    })
    .catch(() => false);
  sink = created;
  return created;
}

export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  await ensureSink(ctx).ready;
}

function outputNode(ctx: AudioContext): AudioNode {
  const s = ensureSink(ctx);
  if (s.ok && s.element.paused) {
    s.element.play().catch(() => {
      s.ok = false;
    });
  }
  return s.ok ? s.node : ctx.destination;
}

// ---------------------------------------------------------------------------
// Playback monitor — what the microphone side needs to know about her voice.
// ---------------------------------------------------------------------------
type PlaybackMonitor = {
  /** Output peak 0..1 this frame. */
  level: number;
  /** A line is being voiced (not paused, not finished). */
  active: boolean;
  paused: boolean;
  /** The last few lines she voiced, newest last — for telling her words from yours. */
  lines: string[];
  outputLatencyMs: number;
  /** performance.now() of the last frame with sound at the output. */
  lastSoundAt: number;
};
const monitor: PlaybackMonitor = {
  level: 0,
  active: false,
  paused: false,
  lines: [],
  outputLatencyMs: 60,
  lastSoundAt: 0,
};
let monitorToken = 0;

export function getPlaybackMonitor(): Readonly<PlaybackMonitor> {
  return monitor;
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type SpeakHandle = {
  /** Ends the line for good. */
  stop: () => void;
  /** Holds the line mid-word; nothing is lost. */
  pause: () => void;
  /** Carries on from a beat before the pause, so the word is heard whole. */
  resume: () => void;
  isPaused: () => boolean;
  /** 0..1 of the line the person has actually heard (frozen once stopped). */
  spokenFraction: () => number;
  done: Promise<void>;
};

/** Streams MARY's speech and reports output amplitude (0..1) each frame. */
export function speak(
  text: string,
  opts: {
    onLevel?: (level: number) => void;
    onFirstAudio?: () => void;
    /** Playback progress 0..1, paced by the audio the person is actually hearing. */
    onProgress?: (progress: number) => void;
    /** Rough expected length in seconds; keeps early progress honest while the stream fills. */
    approxDurationSec?: number;
    onEnd?: () => void;
  } = {},
): SpeakHandle {
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  gain.connect(analyser);
  analyser.connect(outputNode(ctx));

  const token = ++monitorToken;
  monitor.active = true;
  monitor.paused = false;
  monitor.lines = [...monitor.lines.slice(-3), text];
  monitor.outputLatencyMs = Math.round(
    (((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) ||
      ctx.baseLatency ||
      0.05) * 1000,
  );

  const timeData = new Uint8Array(analyser.frequencyBinCount);
  const controller = new AbortController();

  // ---- decoded audio, in arrival order ----
  let pcm = new Float32Array(RATE * Math.max(4, Math.ceil((opts.approxDurationSec ?? 3) * 2)));
  let total = 0;
  let streamDone = false;
  const append = (floats: Float32Array) => {
    if (total + floats.length > pcm.length) {
      const grown = new Float32Array(Math.max(pcm.length * 2, total + floats.length));
      grown.set(pcm.subarray(0, total));
      pcm = grown;
    }
    pcm.set(floats, total);
    total += floats.length;
  };

  // ---- just-in-time scheduling from a cursor ----
  type Piece = { source: AudioBufferSourceNode; startAt: number; length: number; cancelled: boolean };
  const active: Piece[] = [];
  const LOOKAHEAD = 0.4;
  const SLICE = Math.round(RATE * 0.2);
  const MIN_SLICE = Math.round(RATE * 0.06);
  let completed = 0;
  let cursor = 0;
  let scheduledEnd = 0;
  let paused = false;
  let stopped = false;
  let firstAudioFired = false;
  let progress = 0;
  let frozenFraction: number | null = null;
  let raf = 0;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const totalEstimate = () =>
    Math.max(1, streamDone ? total : Math.max(total, (opts.approxDurationSec ?? 0) * RATE));

  const played = () => {
    const now = ctx.currentTime;
    let sum = completed;
    for (const piece of active) {
      sum += Math.max(0, Math.min(piece.length, (now - piece.startAt) * RATE));
    }
    return sum;
  };

  const schedule = () => {
    if (paused || stopped) return;
    const now = ctx.currentTime;
    if (scheduledEnd < now + 0.01) scheduledEnd = now + 0.04;
    while (scheduledEnd - now < LOOKAHEAD && cursor < total) {
      const remaining = total - cursor;
      if (remaining < MIN_SLICE && !streamDone) break;
      const take = Math.min(SLICE, remaining);
      const buffer = ctx.createBuffer(1, take, RATE);
      buffer.copyToChannel(pcm.slice(cursor, cursor + take), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const piece: Piece = { source, startAt: scheduledEnd, length: take, cancelled: false };
      source.onended = () => {
        const index = active.indexOf(piece);
        if (index >= 0) active.splice(index, 1);
        if (!piece.cancelled) completed += piece.length;
      };
      source.start(scheduledEnd);
      active.push(piece);
      scheduledEnd += take / RATE;
      cursor += take;
      if (!firstAudioFired) {
        firstAudioFired = true;
        opts.onFirstAudio?.();
      }
    }
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (frozenFraction === null) frozenFraction = Math.min(1, played() / totalEstimate());
    cancelAnimationFrame(raf);
    for (const piece of active) {
      piece.cancelled = true;
      try {
        piece.source.stop();
      } catch {
        /* already stopped */
      }
    }
    active.length = 0;
    if (monitorToken === token) {
      monitor.active = false;
      monitor.paused = false;
      monitor.level = 0;
    }
    opts.onLevel?.(0);
    opts.onProgress?.(1);
    opts.onEnd?.();
    try {
      analyser.disconnect();
      gain.disconnect();
    } catch {
      /* already disconnected */
    }
    resolveDone();
  };

  let pendingFinish = false;

  const tick = () => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    analyser.getByteTimeDomainData(timeData);
    let peak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = Math.abs(timeData[i]! - 128) / 128;
      if (v > peak) peak = v;
    }
    const level = Math.min(1, peak * 1.6);
    if (monitorToken === token) {
      monitor.level = paused ? 0 : level;
      if (level > 0.02 && !paused) monitor.lastSoundAt = performance.now();
    }
    opts.onLevel?.(paused ? 0 : level);

    schedule();

    if (opts.onProgress && firstAudioFired) {
      const next = Math.min(0.995, played() / totalEstimate());
      if (next > progress) {
        progress = next;
        opts.onProgress(progress);
      }
    }

    if (!pendingFinish && streamDone && !paused && cursor >= total && active.length === 0) {
      // Let the last buffer clear the output device before calling it done.
      pendingFinish = true;
      window.setTimeout(finish, Math.min(400, monitor.outputLatencyMs + 40));
    }
  };

  const pause = () => {
    if (paused || stopped || pendingFinish) return;
    const heard = Math.floor(played());
    paused = true;
    for (const piece of active) {
      piece.cancelled = true;
      try {
        piece.source.stop();
      } catch {
        /* already stopped */
      }
    }
    active.length = 0;
    completed = heard;
    cursor = heard;
    scheduledEnd = 0;
    if (monitorToken === token) {
      monitor.paused = true;
      monitor.level = 0;
    }
    opts.onLevel?.(0);
  };

  const resume = () => {
    if (!paused || stopped) return;
    paused = false;
    if (monitorToken === token) monitor.paused = false;
    const back = Math.min(cursor, Math.round(RATE * 0.15));
    cursor -= back;
    completed = cursor;
    schedule();
  };

  const stop = () => {
    if (frozenFraction === null) frozenFraction = Math.min(1, played() / totalEstimate());
    controller.abort();
    finish();
  };

  const enqueue = (incoming: Uint8Array, pending: { bytes: Uint8Array }) => {
    const merged = new Uint8Array(pending.bytes.length + incoming.length);
    merged.set(pending.bytes);
    merged.set(incoming, pending.bytes.length);
    const usable = merged.length - (merged.length % 2);
    pending.bytes = merged.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(merged.buffer, 0, usable / 2);
    const floats = Float32Array.from(samples, (s) => s / 32768);
    append(floats);
    schedule();
  };

  (async () => {
    await unlockAudio();
    raf = requestAnimationFrame(tick);
    const pending = { bytes: new Uint8Array(0) };
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
        const { value, done: streamEnded } = await reader.read();
        if (streamEnded) break;
        bufferText += value;
        const parts = bufferText.split("\n\n");
        bufferText = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payloadText = line.slice(5).trim();
            if (!payloadText || payloadText === "[DONE]") continue;
            try {
              const payload = JSON.parse(payloadText) as { type?: string; audio?: string };
              if (payload.type === "speech.audio.delta" && payload.audio) {
                enqueue(base64ToBytes(payload.audio), pending);
              }
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      }
      streamDone = true;
      if (total === 0) finish();
      else schedule();
    } catch {
      streamDone = true;
      if (!stopped && total === 0) finish();
    }
  })();

  return {
    stop,
    pause,
    resume,
    isPaused: () => paused,
    spokenFraction: () => frozenFraction ?? Math.min(1, played() / totalEstimate()),
    done,
  };
}

// ---------------------------------------------------------------------------
// Microphone session
// ---------------------------------------------------------------------------
export type Utterance = {
  /** What the person said, with any of MARY's own words already removed. */
  text: string;
  /** The captured audio, for server transcription when the live caption is empty. */
  audio: Blob | null;
  /** The person started talking while MARY was speaking. */
  overAssistant: boolean;
  durationMs: number;
  peak: number;
};

export type MicSession = {
  /** Silences capture without releasing the device (no permission re-prompt). */
  setMuted: (muted: boolean) => void;
  close: () => void;
};

export type MicSessionOptions = {
  onLevel?: (level: number) => void;
  /** You started talking while she was quiet. */
  onSpeechStart?: () => void;
  /** Live caption of the utterance in progress. */
  onInterim?: (text: string) => void;
  /** A complete utterance. */
  onUtterance: (utterance: Utterance) => void;
  /** Sound over her speech that might be you — she should pause right now. */
  onInterruptCandidate?: () => void;
  /** It really is you — she should stay quiet until your words have been handled. */
  onInterruptConfirmed?: () => void;
  /** It was her own voice in the room or a passing noise — she can carry on. */
  onInterruptCancelled?: () => void;
  /** How loudly the microphone hears her (0 = headphones, ~0.3+ = laptop speakers). */
  onEchoCoupling?: (coupling: number) => void;
  silenceMs?: number;
  maxUtteranceMs?: number;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
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
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      // Newer Chrome can cancel every sound the machine plays, not just calls.
      // Unknown constraints are ignored everywhere else.
      ...({ echoCancellationMode: "all" } as Record<string, unknown>),
    } as MediaTrackConstraints,
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);

  // ---- PCM capture with a short pre-roll so the first syllable is never lost ----
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const preRoll: Float32Array[] = [];
  let chunks: Float32Array[] = [];
  let capturing = false;
  let capturePeak = 0;
  let blockPeak = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const v = Math.abs(input[i]!);
      if (v > peak) peak = v;
    }
    blockPeak = Math.max(blockPeak, peak);
    const copy = new Float32Array(input);
    if (capturing) {
      chunks.push(copy);
      if (peak > capturePeak) capturePeak = peak;
    } else {
      preRoll.push(copy);
      if (preRoll.length > 5) preRoll.shift();
    }
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  // ---- state ----
  const data = new Uint8Array(analyser.frequencyBinCount);
  const baseSilenceMs = options.silenceMs ?? 800;
  const maxUtteranceMs = options.maxUtteranceMs ?? 45000;
  const tracker = new EchoTracker();
  const openedAt = performance.now();
  const calibrationMs = 500;
  let noiseFloor = 0.008;
  let muted = false;
  let alive = true;
  let speechCandidateAt = 0;
  let lastSpeechAt = 0;
  let utteranceStartedAt = 0;
  let utteranceOverAssistant = false;
  let lastFinalAt = 0;
  let lastCouplingReport = 0;
  let raf = 0;

  /** She is paused and we are checking whether the sound was really you. */
  let pending: { at: number; frames: number; loud: number; words: boolean } | null = null;
  /** Confirmed: she is held quiet until this utterance resolves. */
  let holding = false;

  const assistantLines = () => monitor.lines;
  const assistantActive = () => monitor.active && !monitor.paused;

  // ---- one recognition stream, owned by the session ----
  let committed = "";
  let interim = "";
  let recognition: Recognition | null = null;
  let recognitionRunning = false;
  let restartTimer = 0;
  let restartAttempt = 0;
  let recognitionFatal = false;

  const emitInterim = () => {
    const live = `${committed} ${interim}`.trim();
    options.onInterim?.(live);
  };

  const wordsSayInterrupt = (text: string) => transcriptConfirmsInterrupt(text, assistantLines());

  const startRecognition = () => {
    if (recognition || !alive || muted || recognitionFatal) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    try {
      const instance = new Ctor();
      instance.continuous = true;
      instance.interimResults = true;
      instance.lang = "en-US";
      instance.onresult = (event) => {
        if (muted) return;
        const inHerWindow = assistantActive() || withinTail();
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const raw = result[0].transcript.trim();
          if (!raw) continue;
          if (result.isFinal) {
            const cleaned = inHerWindow ? stripAssistantEcho(raw, assistantLines()) : raw;
            if (!cleaned || (inHerWindow && isEchoOfAssistant(cleaned, assistantLines()))) continue;
            if (assistantActive() && !pending && !holding) {
              // Words over her speech with no matching sound: only a genuine
              // cut-in counts; "yeah" and "okay" let her carry on.
              if (!wordsSayInterrupt(cleaned)) continue;
              beginCandidate(true);
            }
            committed = `${committed} ${cleaned}`.trim();
            lastFinalAt = performance.now();
            if (pending) pending.words = pending.words || wordsSayInterrupt(cleaned);
          } else {
            live += ` ${raw}`;
          }
        }
        live = live.trim();
        if (live && inHerWindow) {
          live = stripAssistantEcho(live, assistantLines());
          if (live && isEchoOfAssistant(live, assistantLines())) live = "";
        }
        interim = live;
        if (interim && assistantActive() && !pending && !holding && wordsSayInterrupt(interim)) {
          beginCandidate(true);
        } else if (interim && pending && !pending.words && wordsSayInterrupt(interim)) {
          pending.words = true;
        }
        emitInterim();
      };
      instance.onerror = (event) => {
        recognitionRunning = false;
        const code = event?.error ?? "";
        if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
          recognitionFatal = true;
        } else if (code !== "aborted") {
          restartAttempt = Math.min(6, restartAttempt + 1);
        }
      };
      instance.onend = () => {
        recognitionRunning = false;
        if (recognition !== instance) return;
        recognition = null;
        if (!alive || muted || recognitionFatal) return;
        // Browsers end the stream on their own schedule; bring it straight
        // back so the line never goes deaf mid-conversation.
        window.clearTimeout(restartTimer);
        const delay = Math.min(8000, 250 * 2 ** restartAttempt);
        restartTimer = window.setTimeout(startRecognition, delay);
      };
      instance.start();
      recognitionRunning = true;
      recognition = instance;
      restartAttempt = 0;
    } catch {
      recognition = null;
      recognitionRunning = false;
    }
  };

  const stopRecognition = () => {
    window.clearTimeout(restartTimer);
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

  // ---- voice activity + interruption state machine ----
  const tailMs = () => monitor.outputLatencyMs + 380;
  let sincePlayback = Infinity;
  const withinTail = () => !assistantActive() && sincePlayback < tailMs();

  const startCapture = (now: number, overAssistant: boolean) => {
    capturing = true;
    utteranceStartedAt = now;
    utteranceOverAssistant = overAssistant;
    chunks = [...preRoll];
    capturePeak = 0;
    lastSpeechAt = now;
  };

  function beginCandidate(fromWords: boolean) {
    if (pending || holding || muted) return;
    const now = performance.now();
    pending = { at: now, frames: 0, loud: 0, words: fromWords };
    startCapture(now, true);
    options.onInterruptCandidate?.();
  }

  const confirmInterrupt = () => {
    pending = null;
    holding = true;
    options.onInterruptConfirmed?.();
  };

  const cancelInterrupt = () => {
    pending = null;
    capturing = false;
    chunks = [];
    capturePeak = 0;
    speechCandidateAt = 0;
    committed = "";
    interim = "";
    emitInterim();
    tracker.learnFalseInterrupt();
    options.onInterruptCancelled?.();
  };

  const flush = () => {
    const now = performance.now();
    const durationMs = utteranceStartedAt ? now - utteranceStartedAt : 0;
    const wasHolding = holding;
    holding = false;
    const audio = chunks.length ? encodeWav(chunks, ctx.sampleRate) : null;
    const peak = capturePeak;
    chunks = [];
    capturing = false;
    capturePeak = 0;
    speechCandidateAt = 0;
    utteranceStartedAt = 0;
    let text = takeText();
    const lines = assistantLines();
    if (text && (utteranceOverAssistant || withinTail())) {
      text = stripAssistantEcho(text, lines);
      if (text && isEchoOfAssistant(text, lines)) text = "";
    }
    options.onUtterance({
      text,
      audio,
      overAssistant: utteranceOverAssistant || wasHolding,
      durationMs,
      peak,
    });
    utteranceOverAssistant = false;
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
    peak = Math.max(peak, blockPeak);
    blockPeak *= 0.55;
    const now = performance.now();

    const echo = tracker.update(peak, monitor.level, now);
    sincePlayback = echo.sincePlayback;
    if (now - lastCouplingReport > 1500 && echo.coupling !== undefined) {
      lastCouplingReport = now;
      options.onEchoCoupling?.(tracker.peakCoupling);
    }

    if (muted) {
      options.onLevel?.(0);
      return;
    }
    options.onLevel?.(Math.min(1, peak * 1.8));

    if (now - openedAt < calibrationMs) {
      noiseFloor = noiseFloor * 0.88 + peak * 0.12;
      return;
    }

    const speaking = assistantActive();
    const baseThreshold = Math.min(0.3, Math.max(0.02, noiseFloor * 2.8 + 0.008));
    const echoThreshold = Math.min(
      0.95,
      Math.max(baseThreshold, echo.expectedEcho * 1.7 + baseThreshold),
    );

    // ---- she is paused: was that really you? ----
    if (pending) {
      const age = now - pending.at;
      if (age > 160) {
        pending.frames += 1;
        if (peak >= baseThreshold * 1.15) {
          pending.loud += 1;
          lastSpeechAt = now;
        }
      }
      if (pending.words || pending.loud >= 6) {
        confirmInterrupt();
      } else if (age >= 700 && pending.loud < 3) {
        cancelInterrupt();
      }
      return;
    }

    if (speaking) {
      // Her own voice must clear the echo model before it counts as you.
      if (peak >= echoThreshold) {
        if (!speechCandidateAt) speechCandidateAt = now;
        if (now - speechCandidateAt >= 110) {
          speechCandidateAt = 0;
          beginCandidate(false);
        }
      } else {
        speechCandidateAt = 0;
      }
      return;
    }

    const threshold = withinTail() ? echoThreshold : baseThreshold;

    if (peak >= threshold) {
      if (!speechCandidateAt) speechCandidateAt = now;
      lastSpeechAt = now;
      if (!capturing && now - speechCandidateAt >= 140) {
        startCapture(now, false);
        options.onSpeechStart?.();
      }
    } else if (!capturing) {
      speechCandidateAt = 0;
      if (!withinTail()) noiseFloor = noiseFloor * 0.985 + peak * 0.015;
      // Words the level detector missed (a quiet talker) still make a turn.
      if (committed && now - lastFinalAt > 450) flush();
    } else {
      const liveText = `${committed} ${interim}`.trim();
      let wait = endpointDelayMs(liveText, baseSilenceMs);
      // A final result after the last sound is a strong "they're done".
      if (lastFinalAt > lastSpeechAt && liveText) wait = Math.min(wait, 380);
      if (now - lastSpeechAt >= wait) flush();
    }

    if (capturing && now - utteranceStartedAt >= maxUtteranceMs) flush();
  };

  raf = requestAnimationFrame(tick);
  startRecognition();
  // Belt and braces: if recognition quietly died, bring it back.
  const watchdog = window.setInterval(() => {
    if (alive && !muted && !recognitionRunning && !recognition && !recognitionFatal) {
      startRecognition();
    }
  }, 2500);

  return {
    setMuted: (next: boolean) => {
      if (muted === next) return;
      muted = next;
      if (pending) cancelInterrupt();
      holding = false;
      capturing = false;
      chunks = [];
      capturePeak = 0;
      speechCandidateAt = 0;
      committed = "";
      interim = "";
      options.onLevel?.(0);
      options.onInterim?.("");
      if (next) stopRecognition();
      else startRecognition();
    },
    close: () => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      window.clearInterval(watchdog);
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

/** Well-known phrases speech models invent on near-silent audio. */
const HALLUCINATIONS = [
  /^thank(s| you)( for watching| so much)?[.!]?$/i,
  /^(bye|goodbye)[.!]?$/i,
  /^subtitles? by/i,
  /^you[.!]?$/i,
  /^\W*$/,
];

export async function transcribe(blob: Blob): Promise<string> {
  if (blob.size < 2048) return "";
  const form = new FormData();
  form.append("file", blob, "recording.wav");
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) return "";
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (HALLUCINATIONS.some((pattern) => pattern.test(text))) return "";
  return text;
}
