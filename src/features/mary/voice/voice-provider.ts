import { MARY_ONLY, RETELL_PATHS, type VoiceProvider, type VoiceStatus } from "@/lib/retell-shared";

function isVoiceStatus(body: unknown): body is VoiceStatus {
  if (!body || typeof body !== "object") return false;
  const { provider, retell, transcriptKey } = body as Record<string, unknown>;
  return (
    (provider === "mary" || provider === "retell") &&
    typeof retell === "boolean" &&
    (transcriptKey === null || typeof transcriptKey === "string")
  );
}

/**
 * Which voice the server offers, asked once at mount and never inside a tap. Anything
 * short of a well-formed answer in time (an old deploy, a timeout, a 500) means MARY.
 */
export async function fetchVoiceStatus(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  timeoutMs = 2500,
): Promise<VoiceStatus> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<VoiceStatus>((resolve) => {
    timer = setTimeout(() => {
      abort();
      resolve(MARY_ONLY);
    }, timeoutMs);
  });
  const ask = async (): Promise<VoiceStatus> => {
    const response = await fetchImpl(RETELL_PATHS.voice, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return MARY_ONLY;
    const body: unknown = await response.json();
    if (!isVoiceStatus(body)) return MARY_ONLY;
    return { provider: body.provider, retell: body.retell, transcriptKey: body.transcriptKey };
  };
  try {
    return await Promise.race([ask(), timeout]);
  } catch {
    return MARY_ONLY;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * `?voice=mary` always gives MARY; `?voice=retell` gives Retell only when the server
 * offers it; otherwise the server's default stands. "Type instead" never asks.
 */
export function chooseVoiceProvider(status: VoiceStatus, search: string): VoiceProvider {
  const asked = new URLSearchParams(search).get("voice")?.trim().toLowerCase();
  if (asked === "mary") return "mary";
  if (asked === "retell") return status.retell ? "retell" : "mary";
  return status.provider === "retell" && status.retell ? "retell" : "mary";
}
