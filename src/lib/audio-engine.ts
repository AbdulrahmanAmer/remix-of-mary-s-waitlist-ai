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

/** Optional event tap for diagnostics (`window.__maryTrace`). No-op otherwise. */
function trace(event: Record<string, unknown>) {
  const hook = (window as unknown as { __maryTrace?: (e: Record<string, unknown>) => void })
    .__maryTrace;
  if (hook) hook({ t: Math.round(performance.now()), ...event });
}

let sharedContext: AudioContext | null = null;
/** The live microphone track, kept for the on-phone diagnostics panel. */
let activeMicTrack: MediaStreamTrack | null = null;
/** A stream captured during the tap, handed to the session so iOS sees a gesture. */
let primedStream: MediaStream | null = null;

/** Thrown when the device/browser simply cannot do live audio at all. */
export class AudioUnsupportedError extends Error {}

export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new AudioUnsupportedError("no web audio");
    try {
      // Matching her stream rate avoids a resample; older Safari rejects the
      // option, in which case the default rate is used and buffers resample.
      sharedContext = new Ctor({ sampleRate: RATE });
    } catch {
      sharedContext = new Ctor();
    }
  }
  return sharedContext;
}

// ---------------------------------------------------------------------------
// Output sink — her voice leaves through a loopback peer connection and out of
// an <audio> element. That is the one route browsers treat as "sound of the
// far end", so their echo canceller subtracts it from the microphone. Where
// that route cannot be built (no WebRTC, a browser that refuses the local
// negotiation), the same element plays her voice directly instead: being heard
// matters more than the canceller's help, and the local echo model covers it.
// ---------------------------------------------------------------------------
type Sink = {
  node: MediaStreamAudioDestinationNode;
  element: HTMLAudioElement;
  ready: Promise<boolean>;
  /** The browser's call engine is carrying her voice (echo cancellation helps). */
  ok: boolean;
};
let sink: Sink | null = null;
let degraded = false;
/** Direct-to-speaker path, silent until the call route proves inaudible. */
let directGain: GainNode | null = null;
/** Everything she says passes through here before it splits to both routes. */
let hub: GainNode | null = null;
let directOn = false;
/** performance.now() of the last frame where the element clock actually moved. */
let lastElementProgressAt = 0;

/** True when her voice is playing without the browser's echo canceller. */
export function echoCancellationDegraded(): boolean {
  return degraded;
}

/**
 * iPhone Safari mutes and mis-routes the "phone call" audio path (silent
 * switch, earpiece). If the element clock stops moving while a line is
 * playing, her voice also goes straight to the speakers: being heard beats
 * the browser's echo canceller, and the local echo model covers the rest.
 */
function enableDirectOutput() {
  if (directOn || !directGain) return;
  directOn = true;
  degraded = true;
  try {
    directGain.gain.value = 1;
  } catch {
    /* ignore */
  }
  trace({ type: "directOutput" });
}

/** True once her voice had to be pushed straight to the speakers. */
export function directOutputEngaged(): boolean {
  return directOn;
}

/** Sends a stream out and back through the browser's call engine. */
async function loopback(stream: MediaStream): Promise<MediaStream> {
  const Ctor = window.RTCPeerConnection;
  if (!Ctor) throw new Error("no webrtc");
  const from = new Ctor();
  const to = new Ctor();
  const received = new MediaStream();
  const connected = new Promise<MediaStream>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("loopback timeout")), 3000);
    to.ontrack = (event) => {
      received.addTrack(event.track);
      window.clearTimeout(timer);
      resolve(received);
    };
  });
  from.onicecandidate = (e) => {
    if (e.candidate) void to.addIceCandidate(e.candidate);
  };
  to.onicecandidate = (e) => {
    if (e.candidate) void from.addIceCandidate(e.candidate);
  };
  for (const track of stream.getAudioTracks()) from.addTrack(track, stream);
  const offer = await from.createOffer();
  await from.setLocalDescription(offer);
  await to.setRemoteDescription(offer);
  const answer = await to.createAnswer();
  await to.setLocalDescription(answer);
  await from.setRemoteDescription(answer);
  return connected;
}

function ensureSink(ctx: AudioContext): Sink {
  if (sink) return sink;
  const node = ctx.createMediaStreamDestination();
  // The silent fallback path to the real speakers, opened only if the call
  // route turns out to make no sound (iPhone silent switch, earpiece routing).
  hub = ctx.createGain();
  directGain = ctx.createGain();
  directGain.gain.value = 0;
  hub.connect(node);
  hub.connect(directGain);
  directGain.connect(ctx.destination);
  directOn = false;
  const element = document.createElement("audio");
  element.setAttribute("playsinline", "");
  element.autoplay = true;
  element.style.display = "none";
  // Start the element on the direct stream immediately. iPhone Safari only
  // grants playback on the tick of the tap, so the element has to be playing
  // before the loopback negotiation's first await — swapping its source later
  // keeps that permission.
  element.srcObject = node.stream;
  document.body.appendChild(element);
  const primed = element
    .play()
    .then(() => true)
    .catch(() => false);
  const created: Sink = { node, element, ok: false, ready: Promise.resolve(false) };
  created.ready = loopback(node.stream)
    .then(async (out) => {
      element.srcObject = out;
      await element.play().catch(() => {});
      created.ok = true;
      degraded = false;
      trace({ type: "sinkReady" });
      return true;
    })
    .catch(async () => {
      created.ok = false;
      degraded = true;
      element.srcObject = node.stream;
      await element.play().catch(() => {});
      trace({ type: "sinkDegraded" });
      return primed;
    });
  sink = created;
  return created;
}

/** Must finish before her first line, or that line escapes the canceller. */
export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  // A transient autoplay/WebRTC failure gets one clean rebuild.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = ensureSink(ctx);
    if (await current.ready) return;
    if (current.ok) return;
    // Degraded but audible is a valid outcome; only a dead element is retried.
    if (!current.element.paused) return;
    current.element.remove();
    if (sink === current) sink = null;
  }
}

function outputNode(ctx: AudioContext): AudioNode {
  const s = ensureSink(ctx);
  if (s.element.paused) s.element.play().catch(() => {});
  return hub ?? s.node;
}

/**
 * Watches the element's own clock while a line plays. If it never moves the
 * element is not really making sound (blocked autoplay, silent switch, a
 * routing the phone refuses), so the speakers take over.
 */
function watchOutput() {
  const s = sink;
  if (!s) return;
  let last = -1;
  let stuckFrames = 0;
  lastElementProgressAt = performance.now();
  const check = () => {
    if (!sink || sink !== s) return;
    if (!monitor.active || monitor.paused) {
      last = -1;
      stuckFrames = 0;
      window.setTimeout(check, 250);
      return;
    }
    const now = s.element.currentTime;
    if (s.element.paused || now === last) {
      stuckFrames += 1;
      if (stuckFrames >= 3) enableDirectOutput();
    } else {
      stuckFrames = 0;
      lastElementProgressAt = performance.now();
    }
    last = now;
    if (!directOn) window.setTimeout(check, 250);
  };
  window.setTimeout(check, 250);
}

/** What the audio path is actually doing right now, for the on-phone check. */
export function audioDiagnostics() {
  const ctx = sharedContext;
  return {
    context: ctx ? ctx.state : "none",
    sampleRate: ctx?.sampleRate ?? 0,
    callRoute: sink?.ok ?? false,
    elementPaused: sink ? sink.element.paused : true,
    elementTime: sink ? Math.round(sink.element.currentTime * 100) / 100 : 0,
    directOutput: directOn,
    echoCancellationDegraded: degraded,
    speaking: monitor.active && !monitor.paused,
    lastOutputMovedMsAgo: lastElementProgressAt
      ? Math.round(performance.now() - lastElementProgressAt)
      : -1,
    micTrack: activeMicTrack
      ? `${activeMicTrack.readyState}${activeMicTrack.muted ? " (muted)" : ""}`
      : "none",
    micLabel: activeMicTrack?.label ?? "",
    speechRecognition: typeof window !== "undefined" && !!recognitionCtor(),
    secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    inAppBrowser: isInAppBrowser(),
  };
}

/** The last thing she said out loud, so it can be played again on demand. */
let lastSpokenText = "";
export function replayLastLine(): SpeakHandle | null {
  if (!lastSpokenText) return null;
  enableDirectOutput();
  return speak(lastSpokenText);
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
  monitor.lines = [...monitor.lines.slice(-7), text];
  lastSpokenText = text;
  watchOutput();
  trace({ type: "speak", text });
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
  type Piece = {
    source: AudioBufferSourceNode;
    startAt: number;
    length: number;
    cancelled: boolean;
  };
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

  // ---- stall guard ----
  // If the output clock stops moving (context suspended by the OS, a phone
  // call, a backgrounded tab, no audio device at all) nothing above would ever
  // finish and the conversation would hang on "MARY is speaking". This runs
  // on a timer rather than a frame so it also works when frames are paused:
  // nudge the context awake, then walk the remaining words on the wall clock.
  let lastPlayed = -1;
  let lastAdvanceAt = performance.now();
  let stalledFallback = false;
  const STALL_MS = 2500;
  const stallTimer = window.setInterval(() => {
    if (stopped) {
      window.clearInterval(stallTimer);
      return;
    }
    if (paused) {
      lastAdvanceAt = performance.now();
      return;
    }
    const now = performance.now();
    const current = played();
    if (current > lastPlayed + RATE * 0.05) {
      lastPlayed = current;
      lastAdvanceAt = now;
      return;
    }
    // Waiting on the network — for the first bytes, or for more of them with
    // everything received already played — is not an output stall.
    if (!streamDone && (!firstAudioFired || (cursor >= total && active.length === 0))) {
      lastAdvanceAt = now;
      return;
    }
    if (now - lastAdvanceAt < STALL_MS || stalledFallback) return;
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    if (now - lastAdvanceAt < STALL_MS * 1.6) return;

    stalledFallback = true;
    trace({ type: "speak-stall", state: ctx.state });
    window.clearInterval(stallTimer);
    const remainingSec = Math.max(0.6, (totalEstimate() - current) / RATE);
    const from = progress;
    const startedAt = performance.now();
    const walk = window.setInterval(() => {
      if (stopped) {
        window.clearInterval(walk);
        return;
      }
      const fraction = Math.min(1, (performance.now() - startedAt) / (remainingSec * 1000));
      const next = Math.min(0.995, from + (1 - from) * fraction);
      if (next > progress) {
        progress = next;
        opts.onProgress?.(progress);
      }
      if (fraction >= 1) {
        window.clearInterval(walk);
        finish();
      }
    }, 90);
  }, 500);

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
    trace({ type: "pause", fraction: Number((heard / totalEstimate()).toFixed(2)) });
  };

  const resume = () => {
    if (!paused || stopped) return;
    paused = false;
    if (monitorToken === token) monitor.paused = false;
    const back = Math.min(cursor, Math.round(RATE * 0.15));
    cursor -= back;
    completed = cursor;
    trace({ type: "resume" });
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
    // Conference wifi: if her voice never starts arriving, she must not sit
    // silently "speaking" forever — cut the request and show the line instead.
    const firstByteGuard = window.setTimeout(() => {
      if (!stopped && total === 0) controller.abort();
    }, 9000);
    // And a whole line can never take longer than this, however bad the line is.
    const wholeLineGuard = window.setTimeout(() => {
      if (!stopped && !streamDone) controller.abort();
    }, 60000);
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
    } finally {
      window.clearTimeout(firstByteGuard);
      window.clearTimeout(wholeLineGuard);
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
  /**
   * It was her own voice in the room or a passing noise — she can carry on.
   * `heldFirst` means she had already decided it was a real cut-in and went
   * quiet for it; nothing usable came of it, so the hold must be lifted too.
   */
  onInterruptCancelled?: (heldFirst: boolean) => void;
  /** How loudly the microphone hears her (0 = headphones, ~0.3+ = laptop speakers). */
  onEchoCoupling?: (coupling: number) => void;
  /** The microphone went away mid-call: headset unplugged, another app took it. */
  onLost?: (reason: MicFailure) => void;
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

/** Why the microphone could not open — drives what the person is told. */
export type MicFailure = "insecure" | "unsupported" | "denied" | "no-device" | "busy" | "unknown";

export class MicUnavailableError extends Error {
  reason: MicFailure;
  constructor(reason: MicFailure) {
    super(reason);
    this.reason = reason;
  }
}

function micFailureFrom(error: unknown): MicFailure {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "denied";
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  )
    return "no-device";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError")
    return "busy";
  return "unknown";
}

/**
 * True inside an app's built-in browser (Instagram, Facebook, LinkedIn, X,
 * WhatsApp, TikTok). Those often strip the microphone entirely, and the fix is
 * "open this in your real browser", not "check your settings".
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Twitter|MicroMessenger|TikTok|Snapchat|Pinterest|WhatsApp|GSA\//i.test(
    ua,
  );
}

/** What the browser already knows about the microphone, before we ask for it. */
export async function micPermissionState(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const query = (
      navigator as unknown as {
        permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> };
      }
    ).permissions?.query;
    if (!query) return "unknown";
    const status = await query.call(
      (navigator as unknown as { permissions: unknown }).permissions,
      { name: "microphone" },
    );
    const state = status.state;
    return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Asks for the microphone on the tick of the tap. iPhone Safari only treats a
 * request made inside the gesture as one the person asked for; a request a
 * couple of seconds later can be refused with no prompt shown at all. The
 * stream is kept and handed to the session that opens moments later.
 */
export async function primeMicPermission(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicUnavailableError(
      typeof window !== "undefined" && window.isSecureContext === false
        ? "insecure"
        : "unsupported",
    );
  }
  if (primedStream?.getAudioTracks().some((track) => track.readyState === "live")) return;
  try {
    primedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        ...({ echoCancellationMode: "all" } as Record<string, unknown>),
      } as MediaTrackConstraints,
    });
  } catch (error) {
    primedStream = null;
    throw new MicUnavailableError(micFailureFrom(error));
  }
}

export async function startMicSession(options: MicSessionOptions): Promise<MicSession> {
  // A page served over plain http (or an in-app browser that strips the API)
  // has no microphone at all — say so plainly instead of blaming permissions.
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicUnavailableError(
      typeof window !== "undefined" && window.isSecureContext === false
        ? "insecure"
        : "unsupported",
    );
  }

  let stream: MediaStream;
  // A stream captured during the tap is reused: iPhone Safari only reliably
  // grants the microphone while the tap is still being handled.
  const primed = primedStream;
  primedStream = null;
  if (primed && primed.getAudioTracks().some((track) => track.readyState === "live")) {
    stream = primed;
  } else {
    primed?.getTracks().forEach((track) => track.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
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
    } catch (error) {
      throw new MicUnavailableError(micFailureFrom(error));
    }
  }
  activeMicTrack = stream.getAudioTracks()[0] ?? null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new MicUnavailableError("unsupported");
  }
  const ctx = new Ctor();
  // iPhone Safari hands back a suspended context whenever the gesture that
  // started the call has already settled; without this the line is deaf.
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);

  // ---- PCM capture with a short pre-roll so the first syllable is never lost ----
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  /** Recent frames, each marked with whether she was audible at the time. */
  const preRoll: { audio: Float32Array; hers: boolean }[] = [];
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
      preRoll.push({ audio: copy, hers: monitor.active && !monitor.paused });
      // Enough to catch the first syllable, short enough that a cut-in
      // recording carries as little of her own voice as possible.
      if (preRoll.length > 3) preRoll.shift();
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
  /** Running onset score: up on loud frames, down on quiet ones. */
  let loudScore = 0;
  let lastEchoThreshold = 0.02;
  let lastSpeechAt = 0;
  // The last clearly-louder-than-the-room moment. Steady noise keeps
  // `lastSpeechAt` alive forever; this one only moves for real speech.
  let lastRealSpeechAt = 0;
  // When she went quiet for a cut-in, so a hold can never last for ever.
  let holdingSince = 0;
  let utteranceStartedAt = 0;
  let utteranceOverAssistant = false;
  /** Loudest frame of this utterance recorded while she was NOT audible. */
  let cleanPeak = 0;
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
  // Browser speech recognition does not reliably honour acoustic echo
  // cancellation. Keep it completely off while MARY is audible; a real
  // interruption is detected by the local level/echo model first, then the
  // recognizer is reopened after playback has paused.
  let recognitionQuarantined = false;
  /** Earliest time a fresh recognizer may open after MARY pauses. */
  let recognitionReopenAt = 0;

  const emitInterim = () => {
    const live = `${committed} ${interim}`.trim();
    options.onInterim?.(live);
  };

  const wordsSayInterrupt = (text: string) => transcriptConfirmsInterrupt(text, assistantLines());

  const startRecognition = () => {
    if (
      recognition ||
      !alive ||
      muted ||
      recognitionFatal ||
      recognitionQuarantined ||
      assistantActive() ||
      performance.now() < recognitionReopenAt
    )
      return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    try {
      const instance = new Ctor();
      instance.continuous = true;
      instance.interimResults = true;
      instance.lang = "en-US";
      instance.onresult = (event) => {
        if (muted) return;
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const raw = result[0].transcript.trim();
          if (!raw) continue;
          if (result.isFinal) {
            // Her words are stripped whatever the clock says: a late final
            // result can land long after playback, and it is still her voice.
            const cleaned = stripAssistantEcho(raw, assistantLines());
            if (!cleaned || isEchoOfAssistant(cleaned, assistantLines())) continue;
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
        if (live) {
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

  const quarantineRecognition = () => {
    committed = "";
    interim = "";
    options.onInterim?.("");
    stopRecognition();
    recognitionQuarantined = true;
    recognitionReopenAt = Infinity;
  };

  const reopenRecognition = () => {
    if (
      !recognitionQuarantined ||
      !alive ||
      muted ||
      assistantActive() ||
      performance.now() < recognitionReopenAt
    )
      return;
    recognitionQuarantined = false;
    committed = "";
    interim = "";
    startRecognition();
  };

  const takeText = () => {
    const text = `${committed} ${interim}`.trim();
    committed = "";
    interim = "";
    return text;
  };

  // ---- voice activity + interruption state machine ----
  const tailMs = () => monitor.outputLatencyMs + 700;
  let sincePlayback = Infinity;
  const withinTail = () => !assistantActive() && sincePlayback < tailMs();

  const startCapture = (now: number, overAssistant: boolean) => {
    capturing = true;
    utteranceStartedAt = now;
    utteranceOverAssistant = overAssistant;
    // Pre-roll recorded while she was audible is her voice, not theirs.
    chunks = preRoll.filter((f) => !f.hers).map((f) => f.audio);
    capturePeak = 0;
    cleanPeak = 0;
    lastSpeechAt = now;
    lastRealSpeechAt = now;
  };

  function beginCandidate(fromWords: boolean) {
    if (pending || holding || muted) return;
    const now = performance.now();
    pending = { at: now, frames: 0, loud: 0, words: fromWords };
    startCapture(now, true);
    trace({ type: "candidate", fromWords });
    options.onInterruptCandidate?.();
    // onInterruptCandidate pauses MARY synchronously. Start a fresh recognition
    // session, so none of her pre-pause transcript can be delivered as the user.
    recognitionReopenAt = now + monitor.outputLatencyMs + 180;
    window.setTimeout(reopenRecognition, monitor.outputLatencyMs + 190);
  }

  const confirmInterrupt = () => {
    const words = pending?.words ?? false;
    pending = null;
    holding = true;
    holdingSince = performance.now();
    trace({ type: "confirmed", words });
    options.onInterruptConfirmed?.();
  };

  const cancelInterrupt = () => {
    pending = null;
    capturing = false;
    chunks = [];
    capturePeak = 0;
    speechCandidateAt = 0;
    loudScore = 0;
    committed = "";
    interim = "";
    emitInterim();
    tracker.learnFalseInterrupt();
    trace({ type: "cancelled", coupling: tracker.peakCoupling });
    options.onInterruptCancelled?.(false);
  };

  const flush = () => {
    const now = performance.now();
    const durationMs = utteranceStartedAt ? now - utteranceStartedAt : 0;
    const wasHolding = holding;
    holding = false;
    // A recording with no loud moment of its own — every peak arrived while
    // she was audible — is her coming back through the room. Never send it
    // away to be written down.
    const ownVoice = cleanPeak < 0.02;
    const audio = chunks.length && !ownVoice ? encodeWav(chunks, ctx.sampleRate) : null;
    const peak = capturePeak;
    chunks = [];
    capturing = false;
    capturePeak = 0;
    cleanPeak = 0;
    speechCandidateAt = 0;
    loudScore = 0;
    utteranceStartedAt = 0;
    let text = takeText();
    const lines = assistantLines();
    if (text) {
      text = stripAssistantEcho(text, lines);
      if (text && isEchoOfAssistant(text, lines)) text = "";
    }
    trace({
      type: "utterance",
      text,
      durationMs: Math.round(durationMs),
      peak,
      ownVoice,
      over: utteranceOverAssistant || wasHolding,
    });
    if (!text && !audio) {
      utteranceOverAssistant = false;
      options.onInterruptCancelled?.(wasHolding);
      return;
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

    // The room is only learned from frames that already look like echo — the
    // moment the mic climbs past the echo model, learning stops until it settles.
    const echo = tracker.update(
      peak,
      monitor.level,
      now,
      peak < lastEchoThreshold && !pending && !holding,
    );
    lastEchoThreshold = Math.min(0.95, echo.expectedEcho * 1.7 + 0.02);
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
    if (speaking && !recognitionQuarantined) quarantineRecognition();
    if (!speaking && recognitionQuarantined && now >= recognitionReopenAt && !withinTail()) {
      reopenRecognition();
    }
    const baseThreshold = Math.min(0.3, Math.max(0.02, noiseFloor * 2.8 + 0.008));
    const echoThreshold = Math.min(
      0.95,
      Math.max(baseThreshold, echo.expectedEcho * 1.7 + baseThreshold),
    );

    // A hold can never outlive the sentence it was waiting for. If she has been
    // quiet for a cut-in this long with nothing closing it, close it here.
    if (holding && now - holdingSince > 4000) {
      flush();
      return;
    }

    // ---- she is paused: was that really you? ----
    // Her voice takes a moment to drain out of the room after the pause, so
    // the first stretch is ignored; after that, a mic that stays loud with
    // nothing playing can only be a person. The check always ends in a
    // decision, one way or the other.
    if (pending) {
      const age = now - pending.at;
      const settle = 180 + monitor.outputLatencyMs;
      if (age > settle) {
        pending.frames += 1;
        // Her voice is still draining out of the room, so the bar stays at
        // the echo model, not the plain noise floor.
        if (peak >= Math.max(baseThreshold * 1.15, echoThreshold)) {
          pending.loud += 1;
          cleanPeak = Math.max(cleanPeak, peak);
          lastSpeechAt = now;
        }
      }
      if (pending.words || pending.loud >= 6) {
        confirmInterrupt();
      } else if (age >= settle + 520) {
        cancelInterrupt();
      }
      return;
    }

    // Speech is bursty: a syllable gap must not reset the clock, so onset is a
    // running score that climbs on loud frames and eases off on quiet ones.
    const scoreLoud = (loud: boolean) => {
      loudScore = loud ? Math.min(10, loudScore + 1) : Math.max(0, loudScore - 1);
      if (loud && !speechCandidateAt) speechCandidateAt = now;
      if (loudScore === 0) speechCandidateAt = 0;
      return loudScore;
    };

    if (speaking) {
      // She started a line while the person was already mid-sentence: that is
      // not an interruption to verify, it is her turn to wait. She pauses on
      // the spot and stays quiet until what they are saying has been handled.
      if (capturing && !holding) {
        trace({ type: "yield", durationMs: Math.round(now - utteranceStartedAt) });
        utteranceOverAssistant = true;
        options.onInterruptCandidate?.();
        confirmInterrupt();
        return;
      }
      // Her own voice must clear the echo model before it counts as you.
      if (scoreLoud(peak >= echoThreshold) >= 6) {
        speechCandidateAt = 0;
        loudScore = 0;
        trace({
          type: "energy",
          peak: Number(peak.toFixed(3)),
          threshold: Number(echoThreshold.toFixed(3)),
          expected: Number(echo.expectedEcho.toFixed(3)),
          coupling: Number(echo.coupling.toFixed(2)),
          playback: Number(monitor.level.toFixed(3)),
        });
        beginCandidate(false);
      }
      return;
    }

    const threshold = withinTail() ? echoThreshold : baseThreshold;

    if (peak >= threshold) {
      lastSpeechAt = now;
      // Clearly above the room, not just over the line: this is what stops a
      // noisy café from holding a recording open until the 45-second cap.
      if (peak >= threshold * 1.6) lastRealSpeechAt = now;
      cleanPeak = Math.max(cleanPeak, peak);
      if (scoreLoud(true) >= 7 && !capturing) {
        startCapture(now, false);
        cleanPeak = peak;
        options.onSpeechStart?.();
      }
    } else if (!capturing) {
      scoreLoud(false);
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

  // ---- device health: a headset unplugged or a mic stolen by another app must
  // be noticed, not left as an eternally silent line ----
  let lost = false;
  const reportLost = (reason: MicFailure) => {
    if (lost || !alive) return;
    lost = true;
    options.onLost?.(reason);
  };
  const track = stream.getAudioTracks()[0];
  if (track) {
    track.addEventListener("ended", () => reportLost("no-device"));
    // A route change mutes the track for a moment; only a lasting mute counts.
    track.addEventListener("mute", () => {
      window.setTimeout(() => {
        if (alive && track.muted && track.readyState === "live") reportLost("busy");
      }, 1500);
    });
    track.addEventListener("unmute", () => {
      lost = false;
    });
  }
  const onDeviceChange = () => {
    const current = stream.getAudioTracks()[0];
    if (!current || current.readyState === "ended") reportLost("no-device");
  };
  navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);

  raf = requestAnimationFrame(tick);
  startRecognition();
  // Belt and braces: if recognition quietly died, bring it back.
  const watchdog = window.setInterval(() => {
    // Phones suspend audio when the screen locks or the tab goes away; both
    // ends of the call have to be woken or she goes silent and deaf.
    if (alive && ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (alive) {
      const playback = getAudioContext();
      if (playback.state === "suspended") void playback.resume().catch(() => {});
    }
    // A dead capture track looks exactly like a very quiet room; it isn't.
    if (alive && !muted) {
      const live = stream.getAudioTracks()[0];
      if (!live || live.readyState === "ended") reportLost("no-device");
    }
    if (
      alive &&
      !muted &&
      !recognitionRunning &&
      !recognition &&
      !recognitionFatal &&
      !recognitionQuarantined &&
      !assistantActive() &&
      !withinTail() &&
      performance.now() >= recognitionReopenAt
    ) {
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
      loudScore = 0;
      committed = "";
      interim = "";
      options.onLevel?.(0);
      options.onInterim?.("");
      if (next) stopRecognition();
      else if (!assistantActive() && !withinTail()) {
        recognitionQuarantined = false;
        recognitionReopenAt = 0;
        startRecognition();
      }
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
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
      stream.getTracks().forEach((each) => each.stop());
      activeMicTrack = null;
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
