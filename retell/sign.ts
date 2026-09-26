/**
 * Signs a file's exact bytes the way Retell signs webhooks and function calls,
 * for local checks against `bun run preview` (with the key in .dev.vars):
 *
 *   RETELL_WEBHOOK_KEY=… bun retell/sign.ts tests/fixtures/retell/call-ended.signed-up.json
 *   curl -i -X POST http://127.0.0.1:8788/api/retell/webhook \
 *     -H "content-type: application/json" -H "x-retell-signature: <printed>" \
 *     --data-binary @tests/fixtures/retell/call-ended.signed-up.json
 *
 * Mirrors retell-sdk 6.0.1 webhook_auth.ts: `v=<ms>,d=<hex HMAC-SHA256(key, body + ms)>`,
 * accepted for 5 minutes. Uses node:crypto on purpose, independent of the
 * WebCrypto code in src/lib/retell-signature.server.ts. Never prints the key.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const file = process.argv[2];
const key = process.env["RETELL_WEBHOOK_KEY"] || process.env["RETELL_API_KEY"];

if (!file || !key) {
  console.error(
    "usage: RETELL_WEBHOOK_KEY=<key> bun retell/sign.ts <file.json>   (RETELL_API_KEY also works)",
  );
  process.exit(2);
}

const body = readFileSync(file);
const timestamp = Date.now();
const digest = createHmac("sha256", key)
  .update(Buffer.concat([body, Buffer.from(String(timestamp))]))
  .digest("hex");

console.log(`v=${timestamp},d=${digest}`);
