/**
 * First line of defence for the public /api routes, which spend money on every
 * call (LLM, speech, transcription) and accept leads.
 *
 * - Cross-site browser requests are refused (Origin / Sec-Fetch-Site). A
 *   request with neither header is let through, so older browsers and
 *   page-close beacons keep working; a script can forge headers, which is what
 *   the rate limit is for.
 * - A declared body larger than the route allows is refused before it is read.
 * - Each IP gets a per-route budget per minute. The counters live in memory,
 *   so on Cloudflare every isolate counts on its own: this bounds abuse, it
 *   does not make it impossible. A platform rate-limit rule is the next step.
 */

type Budget = { perMinute: number; maxBytes: number };

const KB = 1024;
const BUDGETS: Record<string, Budget> = {
  "/api/turn": { perMinute: 30, maxBytes: 256 * KB },
  "/api/addressee": { perMinute: 60, maxBytes: 16 * KB },
  "/api/speech": { perMinute: 60, maxBytes: 8 * KB },
  "/api/transcribe": { perMinute: 60, maxBytes: 12 * KB * KB },
  "/api/reflect": { perMinute: 6, maxBytes: 128 * KB },
  "/api/lead": { perMinute: 20, maxBytes: 128 * KB },
};
const DEFAULT_BUDGET: Budget = { perMinute: 30, maxBytes: 64 * KB };
const WINDOW_MS = 60_000;
const MAX_TRACKED = 5_000;

const hits = new Map<string, number[]>();

export type GuardVerdict = { ok: true } | { ok: false; status: 403 | 413 | 429; reason: string };

function clientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

function crossSite(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== url.origin) return true;
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site";
}

/** Decide whether an /api request may proceed. Pure apart from the in-memory counters. */
export function checkApiRequest(request: Request, now = Date.now()): GuardVerdict {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return { ok: true };
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return { ok: true };
  }

  if (crossSite(request, url)) return { ok: false, status: 403, reason: "Cross-site request" };

  const budget = BUDGETS[url.pathname] ?? DEFAULT_BUDGET;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > budget.maxBytes) {
    return { ok: false, status: 413, reason: "Request too large" };
  }

  const key = `${clientIp(request)} ${url.pathname}`;
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= budget.perMinute) {
    hits.set(key, recent);
    return { ok: false, status: 429, reason: "Too many requests" };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED) pruneOlderThan(now - WINDOW_MS);
  return { ok: true };
}

function pruneOlderThan(cutoff: number) {
  for (const [key, list] of hits) {
    if ((list[list.length - 1] ?? 0) < cutoff) hits.delete(key);
  }
}

/** For tests. */
export function resetApiGuard() {
  hits.clear();
}
