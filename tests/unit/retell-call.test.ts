import { describe, expect, it, vi, type Mock } from "vitest";
import type { LiveCallUtterance, SessionHooks, WebCallOptions } from "retell-client-js-sdk";

import { createSessionStore } from "@/features/mary/conversation/store";
import { micMessage } from "@/features/mary/conversation/text";
import type { SessionAction } from "@/features/mary/conversation/types";
import { createSignal } from "@/features/mary/signal/signal";
import {
  levelFromSamples,
  makeProxyFetch,
  RETELL_BUSY_ERROR,
  RETELL_CONNECT_ERROR,
  RETELL_HANGOVER_MS,
  RETELL_POLL_MAX_MS,
  RETELL_POLL_MS,
  RetellCall,
  retellErrorMessage,
  transcriptActions,
  type RetellCallDeps,
} from "@/features/mary/voice/retell-call";
import { MicUnavailableError } from "@/lib/audio-engine";
import { RETELL_PATHS, type CallProgress } from "@/lib/retell-shared";

// The adapter takes SDK types only: if it ever loaded the SDK (and livekit with it), this throws.
vi.mock("retell-client-js-sdk", () => {
  throw new Error("retell-call.ts must not load the Retell SDK; only retell-loader.ts may");
});

const CALL_ID = "call_fixture_123";
const SESSION = "w_lx3k2_ab12cd";
const CONTEXT = {
  page: "https://example.com/",
  referrer: "",
  userAgent: "test",
  language: "en-US",
  timezone: "Europe/Berlin",
};

type FakeSession = {
  options: WebCallOptions;
  hooks: SessionHooks;
  callId?: string | undefined;
  mute: Mock<() => void>;
  unmute: Mock<() => void>;
  end: Mock<() => Promise<void>>;
  startAudioPlayback: Mock<() => Promise<void>>;
  analyzerComponent: { analyser: AnalyserNode };
  resume: Mock<() => Promise<void>>;
};

/** Macrotasks, so fetch bodies and the adapter's awaits all run. */
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const json = (body: unknown, status = 200) => Response.json(body, { status });
const progress = (over: Partial<CallProgress> = {}): CallProgress => ({
  saved: false,
  configured: true,
  outcome: "in_progress",
  position: null,
  collected: {},
  ...over,
});

function setup(opts: { transcript?: boolean } = {}) {
  const store = createSessionStore();
  const actions: SessionAction[] = [];
  const dispatch = store.dispatch;
  store.dispatch = (action) => {
    actions.push(action);
    dispatch(action);
  };
  const level = createSignal(0);

  let clock = 1000;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const advance = async (ms: number) => {
    const target = clock + ms;
    for (;;) {
      // Whatever is in flight registers its next timer first.
      await flush();
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
      await flush();
    }
    clock = target;
  };

  const sessions: FakeSession[] = [];
  const createWebCall = vi.fn((options: WebCallOptions) => {
    const hooks = options.hooks ?? {};
    const resume = vi.fn(async () => {});
    const session: FakeSession = {
      options,
      hooks,
      mute: vi.fn(),
      unmute: vi.fn(),
      // Not idempotent on purpose: the adapter must guard a repeated end itself.
      end: vi.fn(async () => {
        hooks.onStatus?.("ended");
        hooks.onEnd?.({});
      }),
      startAudioPlayback: vi.fn(async () => {}),
      analyzerComponent: { analyser: { context: { resume } } as unknown as AnalyserNode },
      resume,
    };
    sessions.push(session);
    return session;
  });
  let proxy: typeof globalThis.fetch | null = null;
  const createClient = vi.fn((proxyFetch: typeof globalThis.fetch) => {
    proxy = proxyFetch;
    return { createWebCall };
  });

  const statusReplies: (() => Response)[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === RETELL_PATHS.callStatus)
      return (statusReplies.shift() ?? (() => json({ found: false })))();
    if (url === RETELL_PATHS.inject) return new Response(null, { status: 204 });
    return json({ call_id: CALL_ID, access_token: "tok" }, 201);
  });
  const calls = (path: string) =>
    fetchMock.mock.calls
      .filter(([url]) => String(url) === path)
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

  let visible = true;
  const deps: RetellCallDeps = {
    store,
    level,
    createClient,
    transcript: opts.transcript ?? false,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    sessionId: () => SESSION,
    context: () => CONTEXT,
    releasePrimedMic: vi.fn(),
    isVisible: () => visible,
    finish: vi.fn(),
    fallback: vi.fn(),
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
  };
  const call = new RetellCall(deps);

  /** Starts a call whose microphone prompt was accepted, and waits for the session. */
  const started = async (known = {}) => {
    call.start(known, Promise.resolve(true));
    await flush();
    return sessions[sessions.length - 1]!;
  };
  const live = async (known = {}) => {
    const session = await started(known);
    session.callId = CALL_ID;
    session.hooks.onStatus?.("live");
    return session;
  };
  return {
    store,
    actions,
    level,
    deps,
    call,
    sessions,
    createWebCall,
    fetch: fetchMock,
    calls,
    statusReplies,
    advance,
    started,
    live,
    proxy: () => proxy!,
    setVisible: (v: boolean) => (visible = v),
    setClock: (ms: number) => (clock = ms),
    clock: () => clock,
  };
}

const say = (id: string, content: string, time = 0): LiveCallUtterance => ({
  id,
  time_sec: time,
  role: "agent",
  content,
});
const hear = (id: string, content: string, time = 0): LiveCallUtterance => ({
  id,
  time_sec: time,
  role: "user",
  content,
});

describe("RetellCall start", () => {
  it("sets up the call screen in the tap, and creates the call only once the mic prompt settles", async () => {
    const t = setup();
    let grant!: (ok: boolean) => void;
    t.call.start({ name: "Leo" }, new Promise<boolean>((resolve) => (grant = resolve)));
    const types = t.actions.map((a) => a.type);
    expect(t.actions).toContainEqual({ type: "SET_VIA", via: "retell" });
    expect(t.actions).toContainEqual({ type: "SET_TALK_MODE", mode: "hands-free" });
    expect(types).toContain("START_CALL");
    expect(t.store.get()).toMatchObject({
      stage: "call",
      via: "retell",
      talkMode: "hands-free",
      presence: "thinking",
      listening: "paused",
    });
    expect(t.call.active).toBe(true);
    await flush();
    expect(t.createWebCall).not.toHaveBeenCalled();
    grant(true);
    await flush();
    expect(t.createWebCall).toHaveBeenCalledTimes(1);
  });

  it("falls back to typing, and creates nothing, when the microphone is refused", async () => {
    const t = setup();
    t.call.start({}, Promise.resolve(false));
    await flush();
    expect(t.createWebCall).not.toHaveBeenCalled();
    expect(t.deps.fallback).toHaveBeenCalledTimes(1);
    expect(t.deps.fallback).toHaveBeenCalledWith([]);
    expect(t.store.get()).toMatchObject({ via: "mary", talkMode: "hold", voiceOff: true });
    expect(t.call.active).toBe(false);
  });

  it("asks for raw audio samples, and live captions only when configured", async () => {
    const off = setup();
    await off.started();
    expect(off.createWebCall.mock.calls[0]![0]).toMatchObject({
      audio: { emitRawAudioSamples: true },
      transcript: false,
    });
    const on = setup({ transcript: true });
    await on.started();
    expect(on.createWebCall.mock.calls[0]![0]).toMatchObject({
      audio: { emitRawAudioSamples: true },
      transcript: true,
    });
  });

  it("ends before anything is created when they hang up while the prompt is open", async () => {
    const t = setup();
    let grant!: (ok: boolean) => void;
    t.call.start({ name: "Leo" }, new Promise<boolean>((resolve) => (grant = resolve)));
    await t.call.end();
    await flush();
    expect(t.deps.finish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(t.deps.finish).mock.calls[0]![0]).toMatchObject({
      outcome: "declined",
      collected: {},
    });
    grant(true);
    await flush();
    expect(t.createWebCall).not.toHaveBeenCalled();
    // The microphone the late grant opened is let go.
    expect(t.deps.releasePrimedMic).toHaveBeenCalledTimes(2);
  });
});

describe("the proxy fetch", () => {
  it("sends create-web-call to our server with the visitor's session, never a key", async () => {
    const t = setup();
    t.call.start({ name: "Leo", industry: "plumbing" }, new Promise(() => {}));
    const response = await t.proxy()("https://api.retellai.com/v3/create-web-call", {
      method: "POST",
      headers: {
        Authorization: "Bearer ",
        "X-Retell-Client-JS-SDK-Version": "3.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agent_id: "set-by-server", agent_override: { x: 1 } }),
    });
    expect(response.status).toBe(201);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetch.mock.calls[0]!;
    expect(url).toBe(RETELL_PATHS.webCall);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-retell-client-js-sdk-version")).toBe("3.0.1");
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: SESSION,
      known: { name: "Leo", industry: "plumbing" },
      context: CONTEXT,
    });
  });

  it("answers stop-call locally and refuses everything else, without a request", async () => {
    const fetch = vi.fn();
    const proxy = makeProxyFetch({
      fetch: fetch as unknown as typeof globalThis.fetch,
      body: () => ({ sessionId: SESSION }),
    });
    const stop = await proxy("https://api.retellai.com/v2/stop-call/call_x", { method: "POST" });
    expect(stop.status).toBe(204);
    for (const path of [
      "/v2/update-live-call/call_x",
      "/v2/listen-live-call/call_x",
      "/v2/get-call/x",
    ]) {
      const other = await proxy(`https://api.retellai.com${path}`, { method: "POST" });
      expect(other.status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("RetellCall live", () => {
  it("hands the microphone over, opens the line and sends what was typed while connecting", async () => {
    const t = setup();
    const session = await t.started();
    t.call.sendText("jo@acme.com");
    expect(t.store.get().lines).toHaveLength(0);
    expect(t.calls(RETELL_PATHS.inject)).toHaveLength(0);
    session.callId = CALL_ID;
    session.hooks.onStatus?.("live");
    expect(t.deps.releasePrimedMic).toHaveBeenCalledTimes(1);
    expect(t.store.get().mic).toMatchObject({ live: true, muted: false, error: null });
    expect(t.store.get().presence).toBe("listening");
    expect(t.store.get().lines).toMatchObject([{ role: "user", text: "jo@acme.com" }]);
    expect(t.calls(RETELL_PATHS.inject)).toEqual([
      { callId: CALL_ID, sessionId: SESSION, text: "jo@acme.com" },
    ]);
    session.hooks.onStatus?.("live");
    expect(t.deps.releasePrimedMic).toHaveBeenCalledTimes(1);
    expect(t.call.live).toBe(true);
  });

  it("sends typed text straight to her while the call is live", async () => {
    const t = setup();
    await t.live();
    t.call.sendText("  leo@marshplumbing.com ");
    expect(t.store.get().lines).toMatchObject([{ role: "user", text: "leo@marshplumbing.com" }]);
    expect(t.store.get().source.text).toBe(true);
    expect(t.calls(RETELL_PATHS.inject)).toEqual([
      { callId: CALL_ID, sessionId: SESSION, text: "leo@marshplumbing.com" },
    ]);
  });

  it("mutes the local microphone track", async () => {
    const t = setup();
    const session = await t.live();
    t.call.setMuted(true);
    expect(session.mute).toHaveBeenCalledTimes(1);
    expect(t.store.get().mic.muted).toBe(true);
    expect(t.store.get().presence).toBe("idle");
    t.call.setMuted(false);
    expect(session.unmute).toHaveBeenCalledTimes(1);
    expect(t.store.get().mic.muted).toBe(false);
  });

  it("starts her audio and the meter from a tap", async () => {
    const t = setup();
    const session = await t.live();
    await t.call.resumeAudio();
    expect(session.startAudioPlayback).toHaveBeenCalledTimes(1);
    expect(session.resume).toHaveBeenCalledTimes(1);
  });
});

describe("her audio drives the orb", () => {
  it("shows her speaking while loud, and listening once quiet for longer than the hangover", async () => {
    const t = setup();
    const session = await t.live();
    session.hooks.onAudio?.(new Float32Array(256).fill(0.2));
    expect(t.level.get()).toBeGreaterThan(0);
    expect(t.store.get().presence).toBe("speaking");
    t.setClock(t.clock() + RETELL_HANGOVER_MS);
    session.hooks.onAudio?.(new Float32Array(256));
    expect(t.store.get().presence).toBe("speaking");
    t.setClock(t.clock() + 1);
    session.hooks.onAudio?.(new Float32Array(256));
    expect(t.store.get().presence).toBe("listening");
    expect(t.level.get()).toBe(0);
  });

  it("goes idle instead of listening when they are muted", async () => {
    const t = setup();
    const session = await t.live();
    t.call.setMuted(true);
    session.hooks.onAudio?.(new Float32Array(256).fill(0.2));
    expect(t.store.get().presence).toBe("speaking");
    t.setClock(t.clock() + 351);
    session.hooks.onAudio?.(new Float32Array(256));
    expect(t.store.get().presence).toBe("idle");
  });

  it("measures level as clamped RMS", () => {
    expect(levelFromSamples(new Float32Array(128))).toBe(0);
    expect(levelFromSamples(new Float32Array(128).fill(1))).toBe(1);
    expect(levelFromSamples(new Float32Array(128).fill(-1))).toBe(1);
    expect(levelFromSamples(new Float32Array(128).fill(0.1))).toBeCloseTo(0.5, 5);
  });
});

describe("live captions", () => {
  it("grows her line in place, captions their turn, then commits it", async () => {
    const t = setup({ transcript: true });
    const session = await t.live();
    session.hooks.onTranscript?.([say("a1", "Hey")], []);
    session.hooks.onTranscript?.([say("a1", "Hey — good to meet you.")], []);
    expect(t.store.get().lines).toEqual([
      { id: "retell:a1", role: "mary", text: "Hey — good to meet you." },
    ]);

    session.hooks.onTranscript?.([say("a1", "Hey — good to meet you."), hear("u1", "I'm Leo")], []);
    expect(t.store.get().interim).toBe("I'm Leo");
    expect(t.store.get().presence).toBe("hearing");
    expect(t.store.get().lines).toHaveLength(1);

    session.hooks.onTranscript?.(
      [
        say("a1", "Hey — good to meet you."),
        hear("u1", "I'm Leo Marsh"),
        say("a2", "Nice to meet you, Leo."),
      ],
      [],
    );
    expect(t.store.get().interim).toBe("");
    expect(t.store.get().lines).toEqual([
      { id: "retell:a1", role: "mary", text: "Hey — good to meet you." },
      { id: "retell:u1", role: "user", text: "I'm Leo Marsh" },
      { id: "retell:a2", role: "mary", text: "Nice to meet you, Leo." },
    ]);
  });

  it("keeps the orb on them while their caption is up", async () => {
    const t = setup({ transcript: true });
    const session = await t.live();
    session.hooks.onTranscript?.([hear("u1", "So we")], []);
    t.setClock(t.clock() + 1000);
    session.hooks.onAudio?.(new Float32Array(256));
    expect(t.store.get().presence).toBe("hearing");
  });

  it("fills the details from a save_lead result, and adds no line for injected text", async () => {
    const t = setup({ transcript: true });
    const session = await t.live({ name: "Leo" });
    t.store.dispatch({ type: "SET_COLLECTED", collected: { name: "Leo" } });
    const items = [
      say("a1", "Got it."),
      {
        id: "i1",
        time_sec: 1,
        role: "injected",
        content: "The visitor typed this instead of saying it: jo@acme.com",
      },
      {
        id: "t1",
        time_sec: 2,
        role: "tool_call_invocation",
        tool_call_id: "tc1",
        name: "save_lead",
        arguments: "{}",
      },
      {
        id: "t2",
        time_sec: 3,
        role: "tool_call_result",
        tool_call_id: "tc1",
        successful: true,
        content: JSON.stringify({
          ...progress({ outcome: "signed_up", saved: true, position: 412 }),
          collected: { name: "Leo", email: "jo@acme.com" },
          recorded: true,
          missing: [],
          rejected: [],
          message: "Saved.",
        }),
      },
    ] as LiveCallUtterance[];
    session.hooks.onTranscript?.(items, []);
    expect(t.store.get().collected).toEqual({ name: "Leo", email: "jo@acme.com" });
    expect(t.store.get().lines).toEqual([{ id: "retell:a1", role: "mary", text: "Got it." }]);
  });

  it("ignores failed, foreign and malformed tool results", () => {
    const invoke = (id: string, name: string) =>
      ({
        id: `inv-${id}`,
        time_sec: 0,
        role: "tool_call_invocation",
        tool_call_id: id,
        name,
        arguments: "{}",
      }) as LiveCallUtterance;
    const result = (id: string, content: string, successful = true) =>
      ({
        id: `res-${id}`,
        time_sec: 0,
        role: "tool_call_result",
        tool_call_id: id,
        successful,
        content,
      }) as LiveCallUtterance;
    const good = JSON.stringify(progress({ collected: { name: "Leo" } }));
    expect(
      transcriptActions([
        invoke("a", "save_lead"),
        result("a", good, false),
        invoke("b", "end_call"),
        result("b", good),
        invoke("c", "note_details"),
        result("c", "{not json"),
        result("d", good),
      ]).progress,
    ).toBeNull();
    expect(transcriptActions([invoke("c", "note_details"), result("c", good)]).progress).toEqual(
      progress({ collected: { name: "Leo" } }),
    );
  });
});

describe("the mid-call poll", () => {
  it("fills the pills only when the details change", async () => {
    const t = setup();
    await t.live();
    const leo = () =>
      json({
        found: true,
        status: "ongoing",
        ended: false,
        disconnectionReason: null,
        progress: progress({ collected: { name: "Leo" } }),
      });
    t.statusReplies.push(leo, leo);
    await t.advance(RETELL_POLL_MS);
    expect(t.calls(RETELL_PATHS.callStatus)).toEqual([{ callId: CALL_ID, sessionId: SESSION }]);
    expect(t.store.get().collected).toEqual({ name: "Leo" });
    await t.advance(RETELL_POLL_MS);
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(2);
    expect(t.actions.filter((a) => a.type === "SET_COLLECTED")).toHaveLength(1);
  });

  it("pauses while the page is hidden", async () => {
    const t = setup();
    await t.live();
    t.setVisible(false);
    await t.advance(RETELL_POLL_MS * 3);
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(0);
    t.setVisible(true);
    await t.advance(RETELL_POLL_MS);
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(1);
  });

  it("backs off on errors, up to a cap, and returns to the normal pace on success", async () => {
    const t = setup();
    await t.live();
    const fail = () => new Response("", { status: 500 });
    t.statusReplies.push(fail, fail, fail, fail);
    const count = () => t.calls(RETELL_PATHS.callStatus).length;
    await t.advance(RETELL_POLL_MS);
    expect(count()).toBe(1);
    await t.advance(RETELL_POLL_MS * 2 - 1);
    expect(count()).toBe(1);
    await t.advance(1);
    expect(count()).toBe(2);
    await t.advance(RETELL_POLL_MAX_MS);
    expect(count()).toBe(3);
    await t.advance(RETELL_POLL_MAX_MS);
    expect(count()).toBe(4);
    // A success (the default reply) resets the pace.
    await t.advance(RETELL_POLL_MAX_MS);
    expect(count()).toBe(5);
    await t.advance(RETELL_POLL_MS);
    expect(count()).toBe(6);
  });
});

describe("a call that never goes live", () => {
  it("falls back once with the error, and ignores the end that follows", async () => {
    const t = setup();
    const session = await t.started();
    t.call.sendText("hello?");
    session.hooks.onError?.(new Error("gateway WHIP POST failed: 500"));
    session.hooks.onEnd?.({});
    expect(t.deps.fallback).toHaveBeenCalledTimes(1);
    expect(t.deps.fallback).toHaveBeenCalledWith(["hello?"]);
    expect(t.deps.finish).not.toHaveBeenCalled();
    expect(t.store.get().mic.error).toBe(RETELL_CONNECT_ERROR);
    expect(t.store.get()).toMatchObject({ via: "mary", talkMode: "hold", voiceOff: true });
    expect(t.store.get().presence).toBe("idle");
    expect(t.deps.releasePrimedMic).toHaveBeenCalledTimes(1);
  });

  it("says the line is busy on a 429, and why the microphone failed", async () => {
    const busy = setup();
    const session = await busy.started();
    session.hooks.onError?.(
      Object.assign(new Error("busy"), { name: "RetellApiError", status: 429 }),
    );
    expect(busy.store.get().mic.error).toBe(RETELL_BUSY_ERROR);

    expect(retellErrorMessage({ status: 429 })).toBe(RETELL_BUSY_ERROR);
    expect(retellErrorMessage({ status: 502 })).toBe(RETELL_CONNECT_ERROR);
    expect(retellErrorMessage(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe(
      micMessage(new MicUnavailableError("denied")),
    );
    expect(retellErrorMessage(Object.assign(new Error("x"), { name: "NotFoundError" }))).toBe(
      micMessage(new MicUnavailableError("no-device")),
    );
    expect(retellErrorMessage(Object.assign(new Error("x"), { name: "NotReadableError" }))).toBe(
      micMessage(new MicUnavailableError("busy")),
    );
    expect(retellErrorMessage(null)).toBe(RETELL_CONNECT_ERROR);
  });

  it("treats an end with no error and no hang-up as a failed connection", async () => {
    const t = setup();
    const session = await t.started();
    session.hooks.onEnd?.({});
    expect(t.deps.fallback).toHaveBeenCalledTimes(1);
    expect(t.store.get().mic.error).toBe(RETELL_CONNECT_ERROR);
    expect(t.deps.finish).not.toHaveBeenCalled();
  });
});

describe("the end of a live call", () => {
  it("finishes once with the saved lead merged in", async () => {
    const t = setup();
    const session = await t.live({ name: "Leo" });
    t.store.dispatch({ type: "SET_COLLECTED", collected: { name: "Leo", industry: "plumbing" } });
    t.statusReplies.push(() =>
      json({
        found: true,
        status: "ended",
        ended: true,
        disconnectionReason: "agent_hangup",
        progress: progress({
          outcome: "signed_up",
          saved: true,
          position: 412,
          collected: { name: "Leo Marsh", email: "leo@marshplumbing.com" },
        }),
      }),
    );
    session.hooks.onError?.(new Error("transport hiccup"));
    expect(t.deps.fallback).not.toHaveBeenCalled();
    await t.call.end();
    expect(t.store.get()).toMatchObject({ presence: "thinking", listening: "paused", interim: "" });
    expect(t.store.get().mic.live).toBe(false);
    expect(t.level.get()).toBe(0);
    await flush();
    expect(t.deps.finish).toHaveBeenCalledTimes(1);
    expect(t.deps.finish).toHaveBeenCalledWith({
      collected: { name: "Leo Marsh", industry: "plumbing", email: "leo@marshplumbing.com" },
      outcome: "signed_up",
      synced: { configured: true, saved: true, position: 412 },
    });
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(1);

    await t.call.end();
    session.hooks.onEnd?.({});
    await t.advance(10_000);
    expect(t.deps.finish).toHaveBeenCalledTimes(1);
    expect(t.call.active).toBe(false);
  });

  it("asks three times, then calls it declined when the call is never found", async () => {
    const t = setup();
    const session = await t.live({ name: "Leo" });
    t.store.dispatch({ type: "SET_COLLECTED", collected: { name: "Leo" } });
    session.hooks.onEnd?.({});
    await flush();
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(1);
    await t.advance(1500);
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(2);
    expect(t.deps.finish).not.toHaveBeenCalled();
    await t.advance(2000);
    expect(t.calls(RETELL_PATHS.callStatus)).toHaveLength(3);
    expect(t.deps.finish).toHaveBeenCalledTimes(1);
    expect(t.deps.finish).toHaveBeenCalledWith({
      collected: { name: "Leo" },
      outcome: "declined",
      synced: { configured: true, saved: false, position: null },
    });
  });

  it("starts a fresh call on Resume, and the old session's hooks do nothing", async () => {
    const t = setup();
    const first = await t.live();
    await t.call.end();
    await t.advance(5000);
    expect(t.deps.finish).toHaveBeenCalledTimes(1);
    const second = await t.started();
    expect(t.createWebCall).toHaveBeenCalledTimes(2);
    expect(t.call.active).toBe(true);
    first.hooks.onStatus?.("live");
    first.hooks.onEnd?.({});
    expect(t.store.get().mic.live).toBe(false);
    second.callId = CALL_ID;
    second.hooks.onStatus?.("live");
    expect(t.store.get().mic.live).toBe(true);
  });
});

describe("dispose", () => {
  it("is safe twice, hangs up, and ignores every hook afterwards", async () => {
    const t = setup();
    const session = await t.started();
    t.call.dispose();
    t.call.dispose();
    expect(session.end).toHaveBeenCalledTimes(1);
    const before = t.actions.length;
    session.hooks.onStatus?.("live");
    session.hooks.onAudio?.(new Float32Array(64).fill(0.5));
    session.hooks.onError?.(new Error("late"));
    session.hooks.onEnd?.({});
    await t.advance(60_000);
    expect(t.actions.length).toBe(before);
    expect(t.deps.fallback).not.toHaveBeenCalled();
    expect(t.deps.finish).not.toHaveBeenCalled();
    expect(t.call.active).toBe(false);
    t.call.start({}, Promise.resolve(true));
    await flush();
    expect(t.createWebCall).toHaveBeenCalledTimes(1);
  });
});
