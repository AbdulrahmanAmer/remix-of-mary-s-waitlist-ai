import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signRetellBody, verifyRetellSignature } from "@/lib/retell-signature.server";

import { signBody } from "./helpers/retell-server";

// Golden vectors produced with retell-sdk 6.0.1 (symmetric.sign / verify) and node:crypto.
const KEY = "key_test_webhook_0123456789";
const TS = 1_790_000_000_000;
const BODY =
  '{"event":"call_ended","call":{"call_id":"call_fixture_1","metadata":{"sessionId":"w_fixture_1"}}}';
const DIGEST = "ebb5b7ad2eefd6abdf14e0157cb0407bf45624ba2a7984e067633cfd4d3d3f85";
const GOLDEN = `v=${TS},d=${DIGEST}`;
const EMPTY_DIGEST = "0bcda201023decb3cd2044f3cca4d17389619d6c56b215483eebc4bf8cd810e8";

const hmac = (input: string, key = KEY) => createHmac("sha256", key).update(input).digest("hex");

describe("verifyRetellSignature / signRetellBody", () => {
  it("verifies the golden vector at its own timestamp", async () => {
    expect(await verifyRetellSignature(BODY, KEY, GOLDEN, TS)).toBe(true);
  });

  it("signs the golden vector byte for byte", async () => {
    expect(await signRetellBody(BODY, KEY, TS)).toBe(GOLDEN);
  });

  it("agrees with node:crypto", () => {
    expect(hmac(BODY + TS)).toBe(DIGEST);
    expect(signBody(BODY, KEY, TS)).toBe(GOLDEN);
  });

  it("fails with the wrong key", async () => {
    expect(await verifyRetellSignature(BODY, "key_test_webhook_0123456780", GOLDEN, TS)).toBe(
      false,
    );
  });

  it("fails when one character of the body changes", async () => {
    const tampered = BODY.replace("w_fixture_1", "w_fixture_2");
    expect(await verifyRetellSignature(tampered, KEY, GOLDEN, TS)).toBe(false);
  });

  it("fails for the same JSON re-serialised: only the raw text verifies", async () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 1);
    expect(await verifyRetellSignature(pretty, KEY, GOLDEN, TS)).toBe(false);
  });

  it("fails without a header", async () => {
    expect(await verifyRetellSignature(BODY, KEY, null, TS)).toBe(false);
    expect(await verifyRetellSignature(BODY, KEY, "", TS)).toBe(false);
  });

  it("fails for malformed headers", async () => {
    const malformed = [
      `v=abc,d=${DIGEST}`,
      `d=${DIGEST},v=${TS}`,
      `v=${TS},d=${DIGEST.slice(1)}`,
      `v=${TS},d=${DIGEST}0`,
      `v=${TS},d=g${DIGEST.slice(1)}`,
      `${GOLDEN},x=1`,
      `v=${TS}, d=${DIGEST}`,
      ` ${GOLDEN}`,
      `${GOLDEN} `,
    ];
    for (const header of malformed) {
      expect(await verifyRetellSignature(BODY, KEY, header, TS), header).toBe(false);
    }
  });

  it("accepts exactly five minutes either way and nothing beyond", async () => {
    expect(await verifyRetellSignature(BODY, KEY, GOLDEN, TS + 300_000)).toBe(true);
    expect(await verifyRetellSignature(BODY, KEY, GOLDEN, TS - 300_000)).toBe(true);
    expect(await verifyRetellSignature(BODY, KEY, GOLDEN, TS + 300_001)).toBe(false);
    expect(await verifyRetellSignature(BODY, KEY, GOLDEN, TS - 300_001)).toBe(false);
  });

  it("accepts an uppercase digest", async () => {
    expect(await verifyRetellSignature(BODY, KEY, `v=${TS},d=${DIGEST.toUpperCase()}`, TS)).toBe(
      true,
    );
  });

  it("verifies the empty-body vector", async () => {
    expect(hmac(`${TS}`)).toBe(EMPTY_DIGEST);
    expect(await verifyRetellSignature("", KEY, `v=${TS},d=${EMPTY_DIGEST}`, TS)).toBe(true);
    expect(await signRetellBody("", KEY, TS)).toBe(`v=${TS},d=${EMPTY_DIGEST}`);
  });

  it("signs the parsed timestamp, not its digits, like the SDK", async () => {
    const padded = "01790000000000";
    expect(await verifyRetellSignature(BODY, KEY, `v=${padded},d=${hmac(BODY + TS)}`, TS)).toBe(
      true,
    );
    expect(await verifyRetellSignature(BODY, KEY, `v=${padded},d=${hmac(BODY + padded)}`, TS)).toBe(
      false,
    );
  });

  it("refuses a timestamp beyond the safe integers", async () => {
    const huge = "9007199254740993";
    expect(
      await verifyRetellSignature(BODY, KEY, `v=${huge},d=${hmac(BODY + huge)}`, Number(huge)),
    ).toBe(false);
  });

  it("refuses an empty secret instead of throwing", async () => {
    expect(await verifyRetellSignature(BODY, "", GOLDEN, TS)).toBe(false);
  });

  it("verifies a UTF-8 body signed by node:crypto", async () => {
    const body = '{"name":"Zoé","note":"see you 🎉"}';
    expect(await verifyRetellSignature(body, KEY, signBody(body, KEY, TS), TS)).toBe(true);
    expect(await signRetellBody(body, KEY, TS)).toBe(signBody(body, KEY, TS));
  });
});
