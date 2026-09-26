import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ANALYSIS_OUTCOMES,
  DYNAMIC_VARIABLES,
  OPENING_LINES,
  RETELL_FUNCTIONS,
  RETELL_PATHS,
  SAVE_LEAD_ARG_KEYS,
  SAVE_LEAD_STAGES,
  WEBHOOK_EVENTS,
} from "@/lib/retell-shared";

import {
  applyPlaybookEdits,
  buildCondensedPrompt,
  buildGeneralPrompt,
  buildRetellConfig,
  estimateTokens,
  normalizeSite,
  PLAYBOOK_EDITS,
  PROMPT_TOKEN_BILLING_STEP,
} from "../../retell/config";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

const playbook = read("docs/mary-voice.md");
const header = read("retell/prompt-header.md");
const condensed = read("retell/playbook-condensed.md");
const llmJson = JSON.parse(read("retell/llm.json")) as Record<string, unknown>;
const agentJson = JSON.parse(read("retell/agent.json")) as Record<string, unknown>;

const SITE = "https://example.com";
const CLOSE_LINE =
  "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom.";

type ToolProperty = { type: string; enum?: string[]; description?: string };
type Tool = {
  type: string;
  name: string;
  url?: string;
  parameters?: { type: string; required?: string[]; properties: Record<string, ToolProperty> };
};
type AnalysisItem = { type: string; name: string; choices?: string[] };

function build(over: Partial<Parameters<typeof buildRetellConfig>[0]> = {}) {
  return buildRetellConfig({
    site: SITE,
    voiceId: "test_voice",
    llm: llmJson,
    agent: agentJson,
    playbookKind: "condensed",
    header: "",
    playbook: condensed,
    dryRun: false,
    ...over,
  });
}

const variablesIn = (text: string) =>
  [...text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]!);

describe("PLAYBOOK_EDITS", () => {
  it("targets wording that occurs exactly once in docs/mary-voice.md", () => {
    for (const { find } of PLAYBOOK_EDITS) {
      expect(playbook.split(find).length - 1, find).toBe(1);
    }
  });

  it("throws when a target is missing", () => {
    expect(() => applyPlaybookEdits("a playbook without the targets")).toThrow(
      /playbook edit target not found/,
    );
  });
});

describe("buildGeneralPrompt", () => {
  const prompt = buildGeneralPrompt(header, playbook);

  it("drops the voice-app wording that does not hold on a Retell call", () => {
    for (const gone of [
      "holding a button",
      "hold the\nbutton",
      "**say**",
      "followUp",
      "Set complete true",
    ]) {
      expect(prompt, gone).not.toContain(gone);
    }
  });

  it("keeps the close line, the tools and the variables, and ends with the field notes", () => {
    expect(prompt).toContain(CLOSE_LINE);
    for (const fn of [...RETELL_FUNCTIONS, "end_call"]) expect(prompt).toContain(fn);
    expect(prompt).toContain("{{known_summary}}");
    expect(prompt.endsWith("{{field_notes}}")).toBe(true);
  });
});

describe("condensed playbook (the default general_prompt)", () => {
  const prompt = buildCondensedPrompt(condensed);

  it("stays under Retell's 4,000-token billing line with room for the tools", () => {
    expect(condensed.length).toBeLessThanOrEqual(12_800);
    expect(build().promptTokens).toBeLessThanOrEqual(3_200);
    expect(build().warnings.some((w) => /tokens/.test(w))).toBe(false);
  });

  it("is used as written: no header, no second field-notes block", () => {
    expect(prompt).toBe(condensed.trim());
    expect(prompt.split("{{field_notes}}")).toHaveLength(2);
    expect(prompt.endsWith("{{field_notes}}")).toBe(true);
    expect(() => buildCondensedPrompt("# no notes")).toThrow(/field_notes/);
  });

  it("names every tool, reads the returning-visitor summary and uses only shared variables", () => {
    for (const fn of [...RETELL_FUNCTIONS, "end_call"]) expect(prompt).toContain(fn);
    expect(prompt).toContain("{{known_summary}}");
    for (const v of variablesIn(prompt)) expect(DYNAMIC_VARIABLES, v).toContain(v);
  });

  it("keeps none of the voice-app wording or the promises nothing keeps", () => {
    for (const gone of [
      "followUp",
      "hold the button",
      "holding a button",
      "Set complete true",
      "confirmation email",
      "a product by Omnikom",
    ]) {
      expect(prompt, gone).not.toContain(gone);
    }
  });
});

describe("buildRetellConfig: llm", () => {
  const cfg = build();
  const llm = cfg.llm;
  const tools = llm["general_tools"] as Tool[];
  const defaults = llm["default_dynamic_variables"] as Record<string, unknown>;

  it("uses only the shared dynamic variables, each with a string default", () => {
    const used = new Set([
      ...variablesIn(String(llm["begin_message"])),
      ...variablesIn(String(llm["general_prompt"])),
    ]);
    expect(used.size).toBeGreaterThan(0);
    for (const v of used) {
      expect(DYNAMIC_VARIABLES, v).toContain(v);
      expect(typeof defaults[v], v).toBe("string");
    }
    expect(defaults["opening_line"]).toBe(OPENING_LINES[0]);
  });

  it("names its tools the way Retell allows, with save_lead, note_details and end_call", () => {
    const names = tools.map((t) => t.name);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    for (const fn of [...RETELL_FUNCTIONS, "end_call"]) expect(names).toContain(fn);
  });

  it("gives every custom tool an object schema whose keys the server accepts", () => {
    const custom = tools.filter((t) => t.type === "custom");
    expect(custom).toHaveLength(RETELL_FUNCTIONS.length);
    for (const tool of custom) {
      const params = tool.parameters!;
      expect(params.type).toBe("object");
      const keys = Object.keys(params.properties);
      for (const required of params.required ?? []) expect(keys).toContain(required);
      for (const key of keys)
        expect(SAVE_LEAD_ARG_KEYS as string[], `${tool.name}.${key}`).toContain(key);
      expect(tool.url).toBe(`${SITE}${RETELL_PATHS.functions}`);
    }
  });

  it("limits save_lead.stage to the shared stages", () => {
    const saveLead = tools.find((t) => t.name === "save_lead")!;
    expect(saveLead.parameters!.properties["stage"]!.enum).toEqual([...SAVE_LEAD_STAGES]);
  });
});

describe("buildRetellConfig: agent", () => {
  const cfg = build();
  const agent = cfg.agent("llm_abc123");
  const analysis = agent["post_call_analysis_data"] as AnalysisItem[];

  it("points the webhook at the site and subscribes to the shared events", () => {
    expect(agent["webhook_url"]).toBe(`${SITE}${RETELL_PATHS.webhook}`);
    expect(agent["webhook_events"]).toEqual([...WEBHOOK_EVENTS]);
  });

  it("asks for the analysis fields the webhook reads", () => {
    const byName = new Map(analysis.map((a) => [a.name, a]));
    expect(byName.get("call_summary")?.type).toBe("system-presets");
    expect(byName.get("outcome")?.choices).toEqual([...ANALYSIS_OUTCOMES]);
    expect(byName.get("callback_requested")?.type).toBe("boolean");
    expect(byName.get("objections")?.type).toBe("string");
  });

  it("substitutes the llm and voice ids and leaves no placeholder behind", () => {
    expect(agent["response_engine"]).toEqual({ type: "retell-llm", llm_id: "llm_abc123" });
    expect(agent["voice_id"]).toBe("test_voice");
    expect(JSON.stringify(agent)).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
    expect(JSON.stringify(cfg.llm)).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
  });
});

describe("normalizeSite", () => {
  it("accepts only an https origin and strips a trailing slash", () => {
    expect(normalizeSite("https://mary.example.com/")).toBe("https://mary.example.com");
    expect(() => normalizeSite("http://mary.example.com")).toThrow(/https/);
    expect(() => normalizeSite("https://mary.example.com/app")).toThrow(/origin/);
    expect(() => normalizeSite("not a url")).toThrow(/https/);
  });
});

describe("buildRetellConfig: guards", () => {
  it("needs a voice unless it is a dry run", () => {
    expect(() => build({ voiceId: "" })).toThrow(/voice/);
    const dry = build({ voiceId: "", dryRun: true });
    expect(dry.agent("llm_x")["voice_id"]).toBe("");
    expect(dry.warnings.some((w) => /voice/.test(w))).toBe(true);
  });

  it("rejects a config that keeps an unknown placeholder", () => {
    expect(() => build({ agent: { ...agentJson, voice_model: "__VOICE_MODEL__" } })).toThrow(
      /__VOICE_MODEL__/,
    );
  });

  it("warns about the billing multiplier of a long prompt and stays under the model window", () => {
    const cfg = build({ playbookKind: "full", header, playbook });
    expect(cfg.promptTokens).toBeGreaterThan(PROMPT_TOKEN_BILLING_STEP);
    expect(cfg.promptTokens).toBeLessThan(32768);
    expect(cfg.warnings.some((w) => /tokens/.test(w) && /x the call minutes/.test(w))).toBe(true);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
