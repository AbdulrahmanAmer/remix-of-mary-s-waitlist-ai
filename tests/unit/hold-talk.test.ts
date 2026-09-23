import { describe, expect, it, vi } from "vitest";

import { HoldTalk, MAX_HOLD_MS, REPRESS_GRACE_MS } from "@/features/mary/voice/hold-talk";

function setup(transcript = "my name is Sara") {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log: string[] = [];
  const recorder = {
    isOpen: true,
    open: vi.fn(async () => {}),
    start: vi.fn(() => log.push("start")),
    stop: vi.fn(() => {
      log.push("stop");
      return { blob: new Blob(["x"]), durationMs: 0, peak: 0.5 };
    }),
  };
  const transcribeHeld = vi.fn(async () => transcript);
  const talk = new HoldTalk({
    recorder,
    transcribeHeld,
    onPress: () => log.push("press"),
    onRelease: () => log.push("release"),
    onCancel: () => log.push("cancel"),
    onText: (text) => log.push(`text:${text}`),
    onMissed: (n) => log.push(`missed:${n}`),
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
  it("stops MARY synchronously on press and sends what was held on release", async () => {
    const { talk, log, advance } = setup();
    talk.press();
    expect(log).toEqual(["press", "start"]);
    await advance(1200);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log).toEqual(["press", "start", "stop", "release", "text:my name is Sara"]);
  });

  it("ignores a mis-tap shorter than the minimum hold", async () => {
    const { talk, log, transcribeHeld, advance } = setup();
    talk.press();
    await advance(150);
    talk.release();
    await advance(REPRESS_GRACE_MS);
    expect(log).toContain("cancel");
    expect(transcribeHeld).not.toHaveBeenCalled();
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
