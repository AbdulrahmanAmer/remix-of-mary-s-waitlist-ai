/**
 * Bridge to the Google Sheet through its Apps Script web app.
 *
 * Nothing here is ever awaited on MARY's speaking path: callers pass a time
 * budget and fall back gracefully when the sheet is slow or not yet connected.
 * The script is in docs/google-sheets/Code.gs; it answers every request with
 * JSON of the shape { ok: boolean, ... }.
 */

export type SheetAction = "lead" | "experience" | "ping";

export function sheetsConfigured(): boolean {
  return Boolean(process.env["SHEETS_WEBAPP_URL"]);
}

function config() {
  const url = process.env["SHEETS_WEBAPP_URL"];
  if (!url) throw new Error("SHEETS_WEBAPP_URL is not set");
  return { url, secret: process.env["SHEETS_WEBAPP_SECRET"] ?? "" };
}

type SheetResponse<T> = ({ ok: true } & T) | { ok: false; error: string };

async function readJson<T>(response: Response): Promise<SheetResponse<T>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sheet request failed [${response.status}]: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as SheetResponse<T>;
  } catch {
    // Apps Script returns an HTML page when the deployment is wrong (e.g.
    // access not set to "Anyone") — surface that instead of a parse error.
    throw new Error(
      `Sheet returned something that is not JSON — check the web app is deployed with access "Anyone". Start of response: ${text.slice(0, 120)}`,
    );
  }
}

function unwrap<T>(body: SheetResponse<T>): T {
  if (!body.ok) throw new Error(`Sheet error: ${body.error}`);
  return body;
}

/** POST an action to the sheet. Apps Script answers POSTs through a redirect, which fetch follows. */
export async function sheetPost<T>(
  action: Exclude<SheetAction, "ping">,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, secret } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      // text/plain keeps Apps Script from choking on a JSON preflight and is
      // exactly what the script reads from e.postData.contents.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, secret, ...payload }),
      redirect: "follow",
      signal: controller.signal,
    });
    return unwrap(await readJson<T>(response));
  } finally {
    clearTimeout(timer);
  }
}

/** GET a read-only action (ping, experience). */
export async function sheetGet<T>(
  action: SheetAction,
  params: Record<string, string | number> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, secret } = config();
  const query = new URLSearchParams({ action, ...(secret ? { secret } : {}) });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000);
  try {
    const response = await fetch(`${url}?${query.toString()}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    return unwrap(await readJson<T>(response));
  } finally {
    clearTimeout(timer);
  }
}
