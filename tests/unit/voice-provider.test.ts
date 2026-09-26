import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseVoiceProvider, fetchVoiceStatus } from "@/features/mary/voice/voice-provider";
import { MARY_ONLY, RETELL_PATHS, type VoiceStatus } from "@/lib/retell-shared";

const RETELL_DEFAULT: VoiceStatus = { provider: "retell", retell: true, transcriptKey: null };
const RETELL_OPT_IN: VoiceStatus = { provider: "mary", retell: true, transcriptKey: "key_pub" };

describe("chooseVoiceProvider", () => {
  it("lets ?voice=mary override a Retell default", () => {
    expect(chooseVoiceProvider(RETELL_DEFAULT, "?voice=mary")).toBe("mary");
    expect(chooseVoiceProvider(RETELL_DEFAULT, "?utm=x&voice=MARY")).toBe("mary");
  });

  it("honours ?voice=retell only when the server offers Retell", () => {
    expect(chooseVoiceProvider(RETELL_OPT_IN, "?voice=retell")).toBe("retell");
    expect(chooseVoiceProvider(MARY_ONLY, "?voice=retell")).toBe("mary");
    expect(chooseVoiceProvider({ ...RETELL_DEFAULT, retell: false }, "?voice=retell")).toBe("mary");
  });

  it("otherwise follows the server's default", () => {
    expect(chooseVoiceProvider(RETELL_DEFAULT, "")).toBe("retell");
    expect(chooseVoiceProvider(RETELL_OPT_IN, "")).toBe("mary");
    expect(chooseVoiceProvider(MARY_ONLY, "?voice=other")).toBe("mary");
    // A default the server cannot back is not taken.
    expect(chooseVoiceProvider({ ...RETELL_DEFAULT, retell: false }, "")).toBe("mary");
  });
});

describe("fetchVoiceStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const replying = (response: () => Response | Promise<Response>) =>
    vi.fn(async () => response()) as unknown as typeof fetch;

  it("returns a valid body as it is, asking /api/voice without caching", async () => {
    const fetchImpl = replying(() => Response.json(RETELL_OPT_IN));
    await expect(fetchVoiceStatus(fetchImpl)).resolves.toEqual(RETELL_OPT_IN);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe(RETELL_PATHS.voice);
    expect(init?.cache).toBe("no-store");
  });

  it("falls back to MARY on a 500, invalid JSON, a wrong shape or a throw", async () => {
    const cases: (() => Response)[] = [
      () => new Response("oops", { status: 500 }),
      () => new Response("{not json", { status: 200 }),
      () => Response.json({ provider: "retell" }),
      () => Response.json({ provider: "elevenlabs", retell: true, transcriptKey: null }),
      () => Response.json({ provider: "retell", retell: "yes", transcriptKey: null }),
      () => Response.json({ provider: "retell", retell: true, transcriptKey: 7 }),
      () => Response.json(null),
      () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    for (const reply of cases) {
      await expect(fetchVoiceStatus(replying(reply))).resolves.toEqual(MARY_ONLY);
    }
  });

  it("falls back to MARY when the answer takes too long", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const answer = fetchVoiceStatus(fetchImpl, undefined, 2500);
    vi.advanceTimersByTime(2499);
    expect(signal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(answer).resolves.toEqual(MARY_ONLY);
    expect(signal?.aborted).toBe(true);
  });

  it("gives up with MARY when the page aborts it", async () => {
    const outer = new AbortController();
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    ) as unknown as typeof fetch;
    const answer = fetchVoiceStatus(fetchImpl, outer.signal);
    outer.abort();
    await expect(answer).resolves.toEqual(MARY_ONLY);
  });
});
