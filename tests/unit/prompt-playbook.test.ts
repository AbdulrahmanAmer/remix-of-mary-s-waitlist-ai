import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const playbook = readFileSync(
  fileURLToPath(new URL("../../docs/mary-voice.md", import.meta.url)),
  "utf8",
);

const count = (needle: string) => playbook.split(needle).length - 1;

describe("docs/mary-voice.md", () => {
  it("keeps every anchor the Retell prompt builder edits around, exactly once", () => {
    const anchors = [
      "holding a button to talk to you in a loud room.",
      "ask them to hold the\nbutton, speak close to the phone, and say it again — or type it.",
      "Set complete true. Say nothing after it.",
      "- **say** — your reaction",
      "- **followUp** — the one next thing",
      "Or null when a reaction alone is",
    ];
    for (const anchor of anchors) expect(count(anchor), anchor).toBe(1);
  });

  it("uses LF line endings", () => {
    expect(playbook).not.toContain("\r");
  });

  it("promises nothing the system does not deliver", () => {
    expect(playbook).not.toMatch(/early-access confirmation/);
    expect(playbook).not.toMatch(/we'll be in touch/);
    expect(playbook).not.toMatch(/request is with the team/);
    expect(playbook).not.toMatch(/Only say it's recorded after it actually saved/);
    expect(playbook).toMatch(/Never promise a confirmation email/);
  });

  it("makes name and email the spot and keeps the rest optional", () => {
    expect(playbook).toMatch(
      /Two things secure their spot: their \*\*name\*\* and\ntheir \*\*email\*\*/,
    );
    expect(playbook).toMatch(/The spot needs only a name and an email/);
    expect(playbook).not.toMatch(/You may never close while any required detail is missing/);
    expect(playbook).toMatch(/record the business as "none"/);
  });

  it("puts the email on the reveal, reads it back, and skips the loops for a rush", () => {
    expect(playbook).toMatch(/"followUp" is the email ask tied to what just happened/);
    expect(playbook).toMatch(/Did I get that right\?/);
    expect(playbook).toMatch(/Skip the loops entirely for someone in a rush/);
    expect(playbook).not.toMatch(/Never followed immediately by an ask or a close/);
  });

  it("worked examples alternate: every MARY turn answers a Person line", () => {
    const lines = playbook.split("\n");
    let previous: "MARY" | "Person" | null = null;
    let inExample = false;
    for (const line of lines) {
      if (/^# \d+\. WORKED EXAMPLE/.test(line)) {
        inExample = true;
        previous = null;
        continue;
      }
      if (/^# \d+\./.test(line) || /^---/.test(line)) inExample = false;
      if (!inExample) continue;
      if (/^And when /.test(line)) previous = null;
      const speaker = line.startsWith("MARY:")
        ? "MARY"
        : line.startsWith("Person:")
          ? "Person"
          : null;
      if (!speaker) continue;
      expect(speaker, line).not.toBe(previous);
      previous = speaker;
    }
  });

  it("keeps the OmniSuite and Omnikom facts", () => {
    for (const fact of [
      "Convert",
      "Cultivate",
      "Recover",
      "two hundred ninety-seven",
      "five ninety-seven",
      "nine ninety-seven",
      "Follow Up Boss, GoHighLevel, REsimpli, HubSpot and Salesforce",
      "Unlimited connected database",
    ])
      expect(playbook, fact).toContain(fact);
  });
});
