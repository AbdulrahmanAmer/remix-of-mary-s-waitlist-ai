/**
 * Retell signs every webhook and custom-function request with the workspace's
 * webhook key: `x-retell-signature: v=<unix ms>,d=<hex HMAC-SHA256(key, body + v)>`.
 *
 * This mirrors retell-sdk 6.0.1 `src/lib/webhook_auth.ts` exactly, WebCrypto
 * only, so it runs on Workers and in tests without the SDK. Easy to get wrong:
 * the signed input is the raw body plus the *parsed* timestamp turned back into
 * a string (so a zero-padded `v=` verifies the way the SDK does), and only the
 * exact raw text verifies — never a re-serialised object.
 */

const SIGNATURE = /^v=(\d+),d=([0-9a-f]+)$/i;
const TOLERANCE_MS = 5 * 60 * 1000;
const DIGEST_HEX_LENGTH = 64;

const encoder = new TextEncoder();

function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** True when `header` is Retell's signature of exactly `rawBody`, made within five minutes of `now`. */
export async function verifyRetellSignature(
  rawBody: string,
  secret: string,
  header: string | null,
  now = Date.now(),
): Promise<boolean> {
  // The SDK throws "Zero-length key" on an empty key; a missing key is simply a failed check here.
  if (!secret || !header) return false;
  const match = SIGNATURE.exec(header);
  if (!match) return false;
  const stamp = Number(match[1]);
  const hex = match[2]!;
  if (
    !Number.isSafeInteger(stamp) ||
    hex.length !== DIGEST_HEX_LENGTH ||
    Math.abs(now - stamp) > TOLERANCE_MS
  ) {
    return false;
  }
  const digest = new Uint8Array(DIGEST_HEX_LENGTH / 2);
  for (let i = 0; i < digest.length; i++) {
    digest[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await hmacKey(secret, "verify");
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, digest, encoder.encode(rawBody + String(stamp)));
}

/** The header Retell would send for `rawBody` at `timestamp` (fixtures and local checks). */
export async function signRetellBody(
  rawBody: string,
  secret: string,
  timestamp = Date.now(),
): Promise<string> {
  const key = await hmacKey(secret, "sign");
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody + timestamp)),
  );
  const hex = Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v=${timestamp},d=${hex}`;
}
