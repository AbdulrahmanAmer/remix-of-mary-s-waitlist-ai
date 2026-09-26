import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HoldTalk,
  MAX_HOLD_MS,
  MIN_HOLD_MS,
  REPRESS_GRACE_MS,
  TranscribeUnavailableError,
  isInventedText,
  transcribeHeldAudio,
} from "@/features/mary/voice/hold-talk";

function setup(transcript = "my name is Sara") {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log: string[] = [];
  const recorder = {
    isOpen: true,
    open: vi.fn(async () => {}),
    start: vi.fn(() => log.push("start")),
    release: vi.fn(),
    stop: vi.fn(() => {
      log.push("stop");
      return { blob: new Blob(["x"]), durationMs: 900, peak: 0.5 };
    }),
  };
  const transcribeHeld = vi.fn(async () => transcript);
  const talk = new HoldTalk({
    recorder,
    transcribeHeld,
    onPress: () => log.push("press"),
    onCommit: () => log.push("commit"),
    onRelease: () => log.push("release"),
    onCancel: (reason) => log.push(`cancel:${reason}`),
    onText: (text) => log.push(`text:${text}`),
    onMissed: (n) => log.push(`missed:${n}`),
    onTranscribeFailed: () => log.push("transcribe-failed"),
    onError: () => log.push("error"),
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
  });
  const advance = async (ms: number) => {
    const target = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
      await Promise.resolve();
    }
    clock = target;
    await new Promise((r) => setTimeout(r, 0));
  };
  return { talk, log, recorder, transcribeHeld, advance };
}

describe("HoldTalk", () => {
  it("pauses MARY on press, commits once the hold outlasts a tap, and sends what was held", async () => {
    const { talk, log, advance } = setup();
    talk.press();
    expect(log).toEqual(["press", "start"]);
    await advance(MIN_HOLD_MS - 1);
    expect(log).not.toContain("commit");
    await advance(1);
    expect(log).toEqual(["press", "start", "commit"]);
    await advance(900);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log).toEqual(["press", "start", "commit", "stop", "release", "text:my name is Sara"]);
  });

  it("a mis-tap never commits: she gets the line back and the person gets a hint", async () => {
    const { talk, log, transcribeHeld, advance } = setup();
    talk.press();
    await advance(150);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log).toEqual(["press", "start", "stop", "cancel:short"]);
    expect(transcribeHeld).not.toHaveBeenCalled();
  });

  it("a hold that crosses the line in pieces commits exactly once", async () => {
    const { talk, log, advance } = setup();
    talk.press();
    await advance(200);
    talk.release();
    await advance(100);
    talk.press();
    await advance(200);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log.filter((l) => l === "commit")).toHaveLength(1);
    expect(log.at(-1)).toBe("text:my name is Sara");
  });

  it("a re-press inside the grace window continues the same clip", async () => {
    const { talk, log, recorder, advance } = setup();
    talk.press();
    await advance(800);
    talk.release();
    await advance(100);
    talk.press();
    await advance(800);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l === "press")).toHaveLength(1);
    expect(log.filter((l) => l === "commit")).toHaveLength(1);
    expect(log.at(-1)).toBe("text:my name is Sara");
  });

  it("lets go by itself after the maximum hold", async () => {
    const { talk, log, advance } = setup();
    talk.press();
    await advance(MAX_HOLD_MS + REPRESS_GRACE_MS);
    expect(log.at(-1)).toBe("text:my name is Sara");
  });

  it("counts empty transcripts in a row and resets on a real one", async () => {
    const { talk, log, transcribeHeld, advance } = setup("");
    const hold = async () => {
      talk.press();
      await advance(900);
      talk.release();
      await advance(REPRESS_GRACE_MS);
    };
    await hold();
    await hold();
    expect(log.filter((l) => l.startsWith("missed"))).toEqual(["missed:1", "missed:2"]);
    transcribeHeld.mockResolvedValueOnce("yes");
    await hold();
    transcribeHeld.mockResolvedValueOnce("");
    await hold();
    expect(log.filter((l) => l.startsWith("missed")).at(-1)).toBe("missed:1");
  });

  it("a silent clip is a miss and never reaches transcription", async () => {
    const { talk, log, recorder, transcribeHeld, advance } = setup();
    recorder.stop.mockReturnValueOnce({ blob: new Blob(["x"]), durationMs: 900, peak: 0.001 });
    talk.press();
    await advance(900);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(transcribeHeld).not.toHaveBeenCalled();
    expect(log.at(-1)).toBe("missed:1");
  });

  it("a transcription that fails is reported as such, never as the person's fault", async () => {
    const { talk, log, transcribeHeld, advance } = setup();
    transcribeHeld.mockRejectedValueOnce(new TranscribeUnavailableError("server"));
    talk.press();
    await advance(900);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log.at(-1)).toBe("transcribe-failed");
    expect(log).not.toContain("missed:1");
    expect(log).not.toContain("error");
  });

  it("keeps a stock phrase when the hold was long and loud enough to have carried it", async () => {
    const { talk, log, recorder, transcribeHeld, advance } = setup("Thank you.");
    // The recorder's clip runs on through the grace window; the hold length is what counts.
    recorder.stop.mockReturnValue({ blob: new Blob(["x"]), durationMs: 5000, peak: 0.3 });
    talk.press();
    await advance(1500);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log.at(-1)).toBe("text:Thank you.");
    transcribeHeld.mockResolvedValueOnce("Thank you.");
    talk.press();
    await advance(400);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log.at(-1)).toBe("missed:1");
  });

  it("opens the microphone on the first press and records only if still held", async () => {
    const { talk, recorder, advance } = setup();
    recorder.isOpen = false;
    recorder.open.mockImplementation(async () => {
      recorder.isOpen = true;
    });
    talk.press();
    await advance(10);
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });
});

describe("isInventedText", () => {
  it("drops a stock phrase only on a clip too short or too quiet to have carried it", () => {
    expect(isInventedText("Thank you.", { durationMs: 400, peak: 0.5 })).toBe(true);
    expect(isInventedText("Bye.", { durationMs: 2000, peak: 0.01 })).toBe(true);
    expect(isInventedText("Thank you.", { durationMs: 1500, peak: 0.3 })).toBe(false);
    expect(isInventedText("My name is Sara", { durationMs: 200, peak: 0.005 })).toBe(false);
    expect(isInventedText("...", { durationMs: 3000, peak: 0.9 })).toBe(true);
  });
});

describe("transcribeHeldAudio", () => {
  afterEach(() => vi.unstubAllGlobals());
  const clip = () => new Blob([new Uint8Array(4096)]);

  it("returns the text on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ text: " hello there " }), { status: 200 })),
    );
    await expect(transcribeHeldAudio(clip())).resolves.toBe("hello there");
  });

  it("a server error is an error, not an empty transcript", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad gateway", { status: 502 })),
    );
    await expect(transcribeHeldAudio(clip())).rejects.toMatchObject({ reason: "server" });
  });

  it("a request that never answers times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      ),
    );
    await expect(transcribeHeldAudio(clip(), 20)).rejects.toMatchObject({ reason: "timeout" });
  });

  it("a clip too small to hold speech never leaves the device", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(transcribeHeldAudio(new Blob(["x"]))).resolves.toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
});
