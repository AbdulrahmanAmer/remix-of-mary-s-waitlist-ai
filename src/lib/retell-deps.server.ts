/**
 * The real dependencies behind the Retell handlers: environment, the sheet,
 * the debrief and background work. Wiring only; the handlers are tested with
 * fakes instead.
 */
import { experienceForTurn, reflectAndStore } from "@/lib/mary-experience.server";
import { readRetellEnv } from "@/lib/retell-env.server";
import type { RetellDeps } from "@/lib/retell-handlers.server";
import { sheetPost, sheetsConfigured } from "@/lib/sheets.server";

type WaitUntil = (task: Promise<unknown>) => void;
type WorkerRequest = Request & {
  waitUntil?: WaitUntil;
  runtime?: { cloudflare?: { context?: { waitUntil?: WaitUntil } } };
};

const noop = () => {};
let reported = false;

/** Nitro's Cloudflare adapter puts a bound waitUntil (and the raw context) on the request. */
function waitUntilOf(request: Request): WaitUntil | null {
  const worker = request as WorkerRequest;
  if (typeof worker.waitUntil === "function") return worker.waitUntil;
  const context = worker.runtime?.cloudflare?.context;
  if (context && typeof context.waitUntil === "function") return context.waitUntil.bind(context);
  return null;
}

/**
 * Keeps `task` running after the response has gone. Without waitUntil the
 * response waits for it instead, at most `fallbackMs`.
 */
export async function deferTask(
  request: Request,
  task: Promise<unknown>,
  fallbackMs = 2500,
): Promise<void> {
  const settled = task.then(noop, noop);
  const waitUntil = waitUntilOf(request);
  if (!reported) {
    reported = true;
    console.info(`[retell] waitUntil available: ${waitUntil ? "yes" : "no"}`);
  }
  if (waitUntil) {
    try {
      waitUntil(settled);
      return;
    } catch {
      // fall through to waiting here
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    settled,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, fallbackMs);
    }),
  ]);
  clearTimeout(timer);
}

/** Read on every request: env changes in Lovable apply without a code change. */
export function retellDeps(request: Request): RetellDeps {
  return {
    env: readRetellEnv(process.env),
    // Bound: Workers throw "Illegal invocation" for a fetch called on another object.
    fetch: globalThis.fetch.bind(globalThis),
    sheetsConfigured,
    sheetPost: (action, payload, opts) => sheetPost<{ position?: unknown }>(action, payload, opts),
    reflect: reflectAndStore,
    fieldNotes: (industry) => experienceForTurn(undefined, industry).catch(() => ""),
    defer: (task) => deferTask(request, task),
    now: Date.now,
    random: Math.random,
    log: console,
  };
}
