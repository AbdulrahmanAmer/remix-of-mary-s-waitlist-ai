/**
 * Pure builders for MARY's Retell agent config. setup.ts applies them and
 * tests/unit/retell-config.test.ts checks them against src/lib/retell-shared.
 * No file or network access here: the caller reads the JSON and markdown.
 */
import { NO_FIELD_NOTES, NOTHING_KNOWN, OPENING_LINES } from "../src/lib/retell-shared";

export type PlaybookEdit = { find: string; replace: string };

/**
 * Wording in docs/mary-voice.md that only holds for MARY's own voice app (a
 * hold button, the say/followUp JSON beats, `complete`). Each `find` occurs
 * exactly once in the playbook; the test fails when the playbook drifts.
 * docs/mary-voice.md itself is never edited.
 */
export const PLAYBOOK_EDITS: ReadonlyArray<PlaybookEdit> = [
  {
    find: "holding a button to talk to you in a loud room.",
    replace: "talking to you on a live voice call, often in a loud room.",
  },
  {
    find: "ask them to hold the\nbutton, speak close to the phone, and say it again — or type it.",
    replace: "ask them to speak close to the phone and say it again — or type it in the box.",
  },
  {
    find: "Set complete true. Say nothing after it.",
    replace: "Then call end_call. Say nothing after it.",
  },
  { find: "- **say** — your reaction", replace: "- **First** — your reaction" },
  { find: "- **followUp** — the one next thing", replace: "- **Then** — the one next thing" },
  { find: "Or null when a reaction alone is", replace: "Or nothing when a reaction alone is" },
];

/** Applies PLAYBOOK_EDITS; throws when a target is missing or occurs more than once. */
export function applyPlaybookEdits(playbook: string): string {
  let out = playbook;
  for (const { find, replace } of PLAYBOOK_EDITS) {
    const first = out.indexOf(find);
    if (first < 0) throw new Error(`playbook edit target not found: ${JSON.stringify(find)}`);
    if (out.indexOf(find, first + find.length) >= 0) {
      throw new Error(`playbook edit target occurs more than once: ${JSON.stringify(find)}`);
    }
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }
  return out;
}

/** The Retell general_prompt: this call's rules, then the edited playbook, then her field notes. */
export function buildGeneralPrompt(header: string, playbook: string): string {
  return (
    header.trim() +
    "\n\n---\n\n# MARY'S PLAYBOOK\n\n" +
    applyPlaybookEdits(playbook).trim() +
    "\n\n# FIELD NOTES\n{{field_notes}}"
  );
}

/** An https origin with no path, query or trailing slash; Retell must reach it from the internet. */
export function normalizeSite(site: string): string {
  let url: URL;
  try {
    url = new URL(site.trim());
  } catch {
    throw new Error(`site must be a full https URL, got ${JSON.stringify(site)}`);
  }
  if (url.protocol !== "https:") throw new Error(`site must use https, got ${url.protocol}`);
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`site must be an origin without a path, got ${JSON.stringify(site)}`);
  }
  return url.origin;
}

/** Rough count; Retell's billing rule needs only the order of magnitude. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Prompts above this many tokens scale Retell's billed minutes by tokens / 4000. */
export const PROMPT_TOKEN_BILLING_STEP = 4000;

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Recursively replaces placeholders inside string values. `fill` maps a whole-string match. */
function substitute(value: JsonValue, fill: Record<string, string>): JsonValue {
  if (typeof value === "string") {
    const whole = fill[value];
    if (whole !== undefined) return whole;
    return value.replace(PLACEHOLDER, (m) => fill[m] ?? m);
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, fill));
  if (value && typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, fill);
    return out;
  }
  return value;
}

function assertNoPlaceholders(what: string, value: JsonValue): void {
  const left = JSON.stringify(value).match(PLACEHOLDER);
  if (left) throw new Error(`${what} still has placeholders: ${[...new Set(left)].join(", ")}`);
}

export type RetellConfigInput = {
  site: string;
  /** A Retell voice id; may be empty on a dry run. */
  voiceId: string;
  llm: Record<string, unknown>;
  agent: Record<string, unknown>;
  header: string;
  playbook: string;
  dryRun: boolean;
};

export type RetellConfig = {
  llm: Record<string, unknown>;
  /** The agent needs the LLM's id, which only exists once the LLM is created. */
  agent: (llmId: string) => Record<string, unknown>;
  promptTokens: number;
  warnings: string[];
};

export function buildRetellConfig(input: RetellConfigInput): RetellConfig {
  const site = normalizeSite(input.site);
  const voiceId = input.voiceId.trim();
  const warnings: string[] = [];
  if (!voiceId) {
    if (!input.dryRun) throw new Error("a Retell voice id is required (--voice <voice_id>)");
    warnings.push("no voice id: agent.json has an empty voice_id and cannot be applied as is");
  }

  const prompt = buildGeneralPrompt(input.header, input.playbook);
  const promptTokens = estimateTokens(prompt);
  if (promptTokens > PROMPT_TOKEN_BILLING_STEP) {
    const multiplier = (promptTokens / PROMPT_TOKEN_BILLING_STEP).toFixed(1);
    warnings.push(
      `prompt is about ${promptTokens} tokens; Retell bills prompts over ${PROMPT_TOKEN_BILLING_STEP} tokens at about ${multiplier}x the call minutes`,
    );
  }

  const fill = {
    __SITE_ORIGIN__: site,
    __GENERATED__: prompt,
    __OPENING_LINE__: OPENING_LINES[0],
    __VOICE_ID__: voiceId,
  };
  const llm = substitute(input.llm as JsonValue, fill) as { [key: string]: JsonValue };
  // The shared constants are the source of truth for the defaults, not the JSON.
  llm["default_dynamic_variables"] = {
    ...(llm["default_dynamic_variables"] as { [key: string]: JsonValue } | undefined),
    opening_line: OPENING_LINES[0],
    known_summary: NOTHING_KNOWN,
    field_notes: NO_FIELD_NOTES,
  };
  assertNoPlaceholders("llm.json", llm);

  const agent = (llmId: string) => {
    if (!llmId) throw new Error("an llm_id is required to build the agent");
    const built = substitute(input.agent as JsonValue, { ...fill, __LLM_ID__: llmId });
    assertNoPlaceholders("agent.json", built);
    return built as Record<string, unknown>;
  };
  // Fail early with the same message a real id would give, so a dry run catches stray placeholders.
  agent("llm_dry_run");

  return { llm, agent, promptTokens, warnings };
}
