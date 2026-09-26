/**
 * A Retell web call driving the same store and level signal MARY's own pipeline
 * does, so every screen works unchanged. Types only from the SDK: the loader hands
 * in the real client, which keeps livekit out of this module and out of the tests.
 */
import type {
  CallEndedEvent,
  LiveCallUtterance,
  SessionHooks,
  SessionStatus,
  WebCallOptions,
} from "retell-client-js-sdk";

import { MicUnavailableError } from "@/lib/audio-engine";
import type { browserContext, LeadSyncResult } from "@/lib/lead-sync";
import type { Collected } from "@/lib/mary.functions";
import {
  CallProgressSchema,
  RETELL_PATHS,
  toCollected,
  type CallProgress,
  type CallStatusResponse,
  type WebCallBody,
} from "@/lib/retell-shared";

import type { SessionStore } from "../conversation/store";
import { fieldsKey, micMessage, uid } from "../conversation/text";
import type { ConversationOutcome, Line } from "../conversation/types";
import type { Signal } from "../signal/signal";

export type RetellSessionLike = {
  callId?: string | undefined;
  mute(): void;
  unmute(): void;
  end(): Promise<void>;
  startAudioPlayback(): Promise<void>;
  analyzerComponent?: { analyser: AnalyserNode } | undefined;
};
export type RetellClientLike = { createWebCall(options: WebCallOptions): RetellSessionLike };

/** What the end screen needs once the call is over. */
export type RetellEnd = {
  collected: Collected;
  outcome: ConversationOutcome;
  synced: LeadSyncResult;
};

export type RetellCallDeps = {
  store: SessionStore;
  level: Signal<number>;
  /** Builds the SDK client around the proxy fetch (the loader passes the real one). */
  createClient: (proxyFetch: typeof fetch) => RetellClientLike;
  /** Live captions: only when a public key can open the transcript socket. */
  transcript: boolean;
  fetch: typeof fetch;
  sessionId: () => string;
  context: () => ReturnType<typeof browserContext>;
  releasePrimedMic: () => void;
  isVisible: () => boolean;
  finish: (end: RetellEnd) => void;
  /** The call never went live: MARY's text chat takes over, with anything typed meanwhile. */
  fallback: (queued: string[]) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

/** RMS of her track above which she counts as speaking. */
export const RETELL_SPEAKING_RMS = 0.015;
export const RETELL_LEVEL_GAIN = 5;
/** She stays "speaking" this long after her audio drops, so the orb does not flicker between words. */
export const RETELL_HANGOVER_MS = 350;
/** After the end: ask how it went at these offsets, stopping once the lead is saved. */
export const RETELL_END_POLLS_MS = [0, 1500, 3500];
export const RETELL_POLL_MS = 8000;
export const RETELL_POLL_MAX_MS = 32000;
export const RETELL_CONNECT_ERROR =
  "I couldn't connect the voice line, so let's keep going by typing — I'm reading.";
export const RETELL_BUSY_ERROR =
  "Lots of people are talking to MARY right now, so let's keep going by typing — I'm reading.";

const noop = () => {};

const RANK: Record<CallProgress["outcome"], number> = { in_progress: 0, callback: 1, signed_up: 2 };
const settledOutcome = (p: CallProgress | null) =>
  p?.outcome === "signed_up" || p?.outcome === "callback" ? p.outcome : null;
/** The more final of two progress reports; a tie goes to the newer one. */
function better(current: CallProgress | null, next: CallProgress): CallProgress {
  return !current || RANK[next.outcome] >= RANK[current.outcome] ? next : current;
}

function progressFrom(value: unknown): CallProgress | null {
  const parsed = CallProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The SDK's control calls go through here. Creating the call goes to our server,
 * which holds the key and decides the agent; the SDK's stop-call is answered at
 * once (Retell's not-joined timeout cleans up), and nothing else leaves the page.
 * WebRTC signalling uses the global fetch and never passes through this.
 */
export function makeProxyFetch(o: { fetch: typeof fetch; body: () => WebCallBody }): typeof fetch {
  const proxy = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url, "https://api.retellai.com").pathname;
    if (path === "/v3/create-web-call") {
      return o.fetch(RETELL_PATHS.webCall, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-retell-client-js-sdk-version":
            new Headers(init?.headers).get("x-retell-client-js-sdk-version") ?? "",
        },
        body: JSON.stringify(o.body()),
      });
    }
    if (path.startsWith("/v2/stop-call/")) return new Response(null, { status: 204 });
    return new Response('{"message":"not proxied"}', { status: 404 });
  };
  return proxy as typeof fetch;
}

function rmsOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Her loudness for the orb, 0..1. */
export function levelFromSamples(samples: Float32Array): number {
  return Math.min(1, rmsOf(samples) * RETELL_LEVEL_GAIN);
}

/**
 * The live transcript as store changes. Her turns become lines that grow in place;
 * a user turn is a caption until anything follows it; save_lead and note_details
 * results carry the grounded details. Typed text is added locally, so `injected`
 * items are skipped.
 */
export function transcriptActions(items: LiveCallUtterance[]): {
  lines: Line[];
  interim: string;
  progress: CallProgress | null;
} {
  const lines: Line[] = [];
  let interim = "";
  let progress: CallProgress | null = null;
  const tools = new Map<string, string>();
  for (const [i, item] of items.entries()) {
    if (item.role === "agent" || item.role === "user") {
      const text = item.content.trim();
      if (!text) continue;
      if (item.role === "user" && i === items.length - 1) interim = text;
      else
        lines.push({
          id: `retell:${item.id}`,
          role: item.role === "agent" ? "mary" : "user",
          text,
        });
    } else if (item.role === "tool_call_invocation") {
      tools.set(item.tool_call_id, item.name);
    } else if (item.role === "tool_call_result") {
      const name = tools.get(item.tool_call_id);
      if (item.successful === false || (name !== "save_lead" && name !== "note_details")) continue;
      try {
        progress = progressFrom(JSON.parse(item.content)) ?? progress;
      } catch {
        /* not our function's JSON */
      }
    }
  }
  return { lines, interim, progress };
}

/** Plain words for why the call could not start; typing always takes over. */
export function retellErrorMessage(error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as {
    name?: unknown;
    status?: unknown;
  };
  if (e.status === 429) return RETELL_BUSY_ERROR;
  switch (e.name) {
    case "NotAllowedError":
    case "SecurityError":
      return micMessage(new MicUnavailableError("denied"));
    case "NotFoundError":
      return micMessage(new MicUnavailableError("no-device"));
    case "NotReadableError":
      return micMessage(new MicUnavailableError("busy"));
    default:
      return RETELL_CONNECT_ERROR;
  }
}

/**
 * One visitor's Retell calls (a Resume starts the next one). `start` runs inside the
 * Start tap and never awaits: the call is created only once the microphone prompt
 * the tap opened has settled, so no paid call is minted while it is up, or after a no.
 */
export class RetellCall {
  private readonly client: RetellClientLike;
  private session: RetellSessionLike | null = null;
  /** Bumped by every start and by dispose; hooks from an older session do nothing. */
  private generation = 0;
  private known: Collected = {};
  private started = false;
  private isLive = false;
  private ended = false;
  private failed = false;
  private finished = false;
  private endRequested = false;
  private disposed = false;
  private micReleased = false;
  private queue: string[] = [];
  private lastLoud = 0;
  private best: CallProgress | null = null;
  private pollTimer = 0;
  private pollDelay = RETELL_POLL_MS;
  private readonly timers = new Set<number>();

  constructor(private readonly deps: RetellCallDeps) {
    this.client = deps.createClient(
      makeProxyFetch({
        fetch: deps.fetch,
        body: () => ({ sessionId: deps.sessionId(), known: this.known, context: deps.context() }),
      }),
    );
  }

  /** Started and not yet over (settled) or handed back to MARY (failed). */
  get active(): boolean {
    return this.started && !this.finished && !this.failed && !this.disposed;
  }

  get live(): boolean {
    return this.isLive && !this.ended && !this.failed && !this.disposed;
  }

  start(known: Collected, micReady: Promise<boolean>): void {
    if (this.disposed) return;
    const gen = ++this.generation;
    const previous = this.session;
    this.session = null;
    if (previous) void previous.end().catch(noop);
    this.clearTimers();
    this.known = { ...known };
    this.started = true;
    this.isLive = false;
    this.ended = false;
    this.failed = false;
    this.finished = false;
    this.endRequested = false;
    this.micReleased = false;
    this.queue = [];
    this.lastLoud = 0;
    this.best = null;
    this.pollDelay = RETELL_POLL_MS;

    const { store, now } = this.deps;
    store.dispatch({ type: "SET_VIA", via: "retell" });
    store.dispatch({ type: "SET_TALK_MODE", mode: "hands-free" });
    store.dispatch({ type: "SET_MIC", mic: { muted: false, error: null } });
    store.dispatch({ type: "START_CALL", at: now() });
    store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });
    store.dispatch({ type: "SET_LISTENING", listening: "paused" });
    store.dispatch({ type: "NOTE_SOURCE", via: "voice" });

    const create = (ok: boolean) => {
      if (this.disposed || gen !== this.generation) return;
      // Hung up while the prompt was open: the microphone it granted goes straight back.
      if (this.ended || this.failed) {
        if (ok) this.deps.releasePrimedMic();
        return;
      }
      if (!ok) return this.failBeforeLive(null);
      try {
        this.session = this.client.createWebCall({
          // The server sets the real agent; this never leaves the page.
          agent_id: "set-by-server",
          audio: { emitRawAudioSamples: true },
          transcript: this.deps.transcript,
          hooks: this.hooks(gen),
        });
      } catch (error) {
        this.failBeforeLive(retellErrorMessage(error));
      }
    };
    micReady.then(create, () => create(false));
  }

  /** A local mute of the microphone track; she keeps talking. */
  setMuted(muted: boolean): void {
    const session = this.session;
    if (!session || !this.live) return;
    if (muted) session.mute();
    else session.unmute();
    const { store } = this.deps;
    store.dispatch({ type: "SET_MIC", mic: { muted } });
    store.dispatch({ type: "SET_PRESENCE", presence: muted ? "idle" : "listening" });
  }

  /** Typed text reaches her as if said; before the line is up it waits in a queue. */
  sendText(text: string): void {
    const clean = text.trim();
    if (!clean || !this.active) return;
    const callId = this.session?.callId;
    if (this.live && callId) this.deliver(clean, callId);
    else if (!this.ended) this.queue.push(clean);
  }

  /** From a tap ("Can't hear her?"): her audio element and the meter both start inside it. */
  async resumeAudio(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const playback = session.startAudioPlayback().catch(noop);
    const meter = (session.analyzerComponent?.analyser.context as AudioContext | undefined)
      ?.resume?.()
      .catch(noop);
    await Promise.all([playback, meter]);
  }

  /** The visitor hangs up. */
  async end(): Promise<void> {
    this.endRequested = true;
    const session = this.session;
    if (session) return session.end();
    // Nothing to hang up yet (the microphone prompt is still open): the call is over as it is.
    if (this.started && this.active && !this.ended) this.onEnd();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.clearTimers();
    const session = this.session;
    this.session = null;
    if (session) void session.end().catch(noop);
  }

  private hooks(gen: number): SessionHooks {
    const current = () => !this.disposed && gen === this.generation;
    return {
      onStatus: (status: SessionStatus) => {
        if (current() && status === "live") this.onLive();
      },
      onAudio: (samples: Float32Array) => {
        if (current()) this.onAudio(samples);
      },
      onTranscript: (items: LiveCallUtterance[]) => {
        if (current()) this.onTranscript(items);
      },
      onError: (error: Error) => {
        if (!current()) return;
        if (this.isLive) console.warn("[retell]", error.message);
        else this.failBeforeLive(retellErrorMessage(error));
      },
      onEnd: (_event: CallEndedEvent) => {
        if (current()) this.onEnd();
      },
    };
  }

  private onLive(): void {
    if (this.isLive || this.ended || this.failed) return;
    this.isLive = true;
    // The tap's microphone kept capture alive until the SDK opened its own.
    this.releaseMic();
    const { store } = this.deps;
    store.dispatch({ type: "SET_MIC", mic: { live: true, muted: false, error: null } });
    store.dispatch({ type: "SET_LISTENING", listening: "listening" });
    store.dispatch({ type: "SET_PRESENCE", presence: "listening" });
    const queued = this.queue;
    this.queue = [];
    const callId = this.session?.callId;
    if (callId) for (const text of queued) this.deliver(text, callId);
    this.schedulePoll(RETELL_POLL_MS);
  }

  /** Her track only: the gateway sends no talking events, so loudness is the signal. */
  private onAudio(samples: Float32Array): void {
    if (!this.isLive || this.ended || this.failed) return;
    const { store, level, now } = this.deps;
    level.set(levelFromSamples(samples));
    if (rmsOf(samples) > RETELL_SPEAKING_RMS) {
      this.lastLoud = now();
      store.dispatch({ type: "SET_PRESENCE", presence: "speaking" });
    } else if (now() - this.lastLoud > RETELL_HANGOVER_MS) {
      const state = store.get();
      // A caption on screen means they are talking; the orb keeps showing that.
      const quiet = state.interim ? "hearing" : state.mic.muted ? "idle" : "listening";
      store.dispatch({ type: "SET_PRESENCE", presence: quiet });
    }
  }

  private onTranscript(items: LiveCallUtterance[]): void {
    if (this.ended || this.failed) return;
    const { store } = this.deps;
    const { lines, interim, progress } = transcriptActions(items);
    for (const line of lines) store.dispatch({ type: "UPSERT_LINE", line });
    store.dispatch({ type: "SET_INTERIM", interim });
    if (interim) store.dispatch({ type: "SET_PRESENCE", presence: "hearing" });
    if (progress) this.noteProgress(progress);
  }

  /** New grounded details fill the pills; the most final report is kept for the end. */
  private noteProgress(progress: CallProgress): void {
    const { store } = this.deps;
    const collected = store.get().collected;
    const merged = { ...collected, ...toCollected(progress.collected) };
    if (fieldsKey(merged) !== fieldsKey(collected))
      store.dispatch({ type: "SET_COLLECTED", collected: merged });
    this.best = better(this.best, progress);
  }

  private deliver(text: string, callId: string): void {
    const { store } = this.deps;
    store.dispatch({ type: "ADD_LINE", line: { id: uid(), role: "user", text } });
    store.dispatch({ type: "NOTE_SOURCE", via: "text" });
    void this.deps
      .fetch(RETELL_PATHS.inject, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callId,
          sessionId: this.deps.sessionId(),
          text: text.slice(0, 500),
        }),
      })
      .catch(noop);
  }

  /** POST call-status; `ok` false on any failure, `status` null when the body is not one. */
  private async callStatus(
    callId: string,
  ): Promise<{ ok: boolean; status: CallStatusResponse | null }> {
    try {
      const response = await this.deps.fetch(RETELL_PATHS.callStatus, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId, sessionId: this.deps.sessionId() }),
      });
      if (!response.ok) return { ok: false, status: null };
      const body = (await response.json()) as Partial<CallStatusResponse> | null;
      if (body?.found === false) return { ok: true, status: { found: false } };
      if (body?.found !== true) return { ok: true, status: null };
      return {
        ok: true,
        status: {
          found: true,
          status: typeof body.status === "string" ? body.status : "unknown",
          ended: body.ended === true,
          disconnectionReason:
            typeof body.disconnectionReason === "string" ? body.disconnectionReason : null,
          progress: progressFrom(body.progress),
        },
      };
    } catch {
      return { ok: false, status: null };
    }
  }

  private progressOf(status: CallStatusResponse | null): CallProgress | null {
    return status?.found ? status.progress : null;
  }

  /** Mid-call, while the page is visible: pills fill in as she records details. */
  private schedulePoll(ms: number): void {
    this.deps.clearTimer(this.pollTimer);
    this.timers.delete(this.pollTimer);
    this.pollTimer = this.deps.setTimer(() => void this.poll(), ms);
    this.timers.add(this.pollTimer);
  }

  private async poll(): Promise<void> {
    const gen = this.generation;
    const callId = this.session?.callId;
    if (!this.live) return;
    if (!callId || !this.deps.isVisible()) return this.schedulePoll(this.pollDelay);
    const { ok, status } = await this.callStatus(callId);
    if (gen !== this.generation || !this.live) return;
    this.pollDelay = ok ? RETELL_POLL_MS : Math.min(this.pollDelay * 2, RETELL_POLL_MAX_MS);
    const progress = this.progressOf(status);
    if (progress) this.noteProgress(progress);
    this.schedulePoll(this.pollDelay);
  }

  private onEnd(): void {
    if (this.ended || this.failed) return;
    // The SDK ends a call that never connected; only a hang-up is a real end then.
    if (!this.isLive && !this.endRequested) return this.failBeforeLive(RETELL_CONNECT_ERROR);
    this.ended = true;
    const { store, level } = this.deps;
    this.clearTimers();
    level.set(0);
    store.dispatch({ type: "SET_PRESENCE", presence: "thinking" });
    store.dispatch({ type: "SET_LISTENING", listening: "paused" });
    store.dispatch({ type: "SET_MIC", mic: { live: false } });
    store.dispatch({ type: "SET_INTERIM", interim: "" });
    this.releaseMic();
    void this.settle(this.generation);
  }

  /** How the call went: asked of our server a few times, then the end screen, exactly once. */
  private async settle(gen: number): Promise<void> {
    const callId = this.session?.callId;
    let best = this.best;
    if (callId) {
      let at = 0;
      for (const offset of RETELL_END_POLLS_MS) {
        if (settledOutcome(best)) break;
        if (offset > at) await this.sleep(offset - at);
        at = offset;
        if (gen !== this.generation || this.disposed) return;
        const progress = this.progressOf((await this.callStatus(callId)).status);
        if (gen !== this.generation || this.disposed) return;
        if (progress) best = better(best, progress);
      }
    }
    if (this.finished) return;
    this.finished = true;
    const { store } = this.deps;
    this.deps.finish({
      collected: { ...store.get().collected, ...toCollected(best?.collected ?? {}) },
      outcome: settledOutcome(best) ?? "declined",
      synced: {
        configured: best?.configured ?? true,
        saved: best?.saved ?? false,
        position: best?.position ?? null,
      },
    });
  }

  /** The call never went live: back to MARY's text chat, as after "Type instead". */
  private failBeforeLive(message: string | null): void {
    if (this.failed || this.ended) return;
    this.failed = true;
    // Whatever the SDK still has going (a non-fatal error mid-connect) stops here.
    const session = this.session;
    this.session = null;
    if (session) void session.end().catch(noop);
    this.releaseMic();
    this.clearTimers();
    const { store, level } = this.deps;
    level.set(0);
    store.dispatch({
      type: "SET_MIC",
      mic: { live: false, ...(message ? { error: message } : {}) },
    });
    store.dispatch({ type: "SET_VIA", via: "mary" });
    store.dispatch({ type: "SET_TALK_MODE", mode: "hold" });
    store.dispatch({ type: "SET_VOICE_OFF", off: true });
    store.dispatch({ type: "SET_LISTENING", listening: "paused" });
    store.dispatch({ type: "SET_PRESENCE", presence: "idle" });
    const queued = this.queue;
    this.queue = [];
    this.deps.fallback(queued);
  }

  private releaseMic(): void {
    if (this.micReleased) return;
    this.micReleased = true;
    this.deps.releasePrimedMic();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = this.deps.setTimer(() => {
        this.timers.delete(id);
        resolve();
      }, ms);
      this.timers.add(id);
    });
  }

  private clearTimers(): void {
    for (const id of this.timers) this.deps.clearTimer(id);
    this.timers.clear();
    this.pollTimer = 0;
  }
}
