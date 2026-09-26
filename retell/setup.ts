/**
 * Creates or updates MARY's Retell LLM and agent from the files in retell/.
 *
 *   bun retell/setup.ts --site https://<published-host> --voice <voice_id> [--apply] [--publish]
 *
 * Without --apply it is a dry run: it builds the config, prints the prompt token
 * estimate and writes retell/out/{llm,agent}.json (gitignored) for review.
 * --apply needs RETELL_API_KEY in the shell; RETELL_LLM_ID and RETELL_AGENT_ID
 * turn create into update. --publish publishes the agent version --apply
 * produced. Uses node:fs and fetch only, and never prints a key.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildRetellConfig } from "./config";

const RETELL_API = "https://api.retellai.com";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = `${ROOT}retell/out/`;

const USAGE = `usage: bun retell/setup.ts --site https://<published-host> --voice <voice_id> [--apply] [--publish]

  --site     the published origin Retell will call back (https only)
  --voice    a Retell voice id from the dashboard (optional on a dry run)
  --apply    create or update the LLM and agent; needs RETELL_API_KEY
             (RETELL_LLM_ID / RETELL_AGENT_ID in the shell switch create to update)
  --publish  with --apply: publish the agent version that was just written`;

type Args = { site: string; voice: string; apply: boolean; publish: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { site: "", voice: "", apply: false, publish: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") args.site = argv[++i] ?? "";
    else if (a === "--voice") args.voice = argv[++i] ?? "";
    else if (a === "--apply") args.apply = true;
    else if (a === "--publish") args.publish = true;
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  if (!args.site) {
    console.error(`--site is required\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.publish && !args.apply) {
    console.error("--publish needs --apply (it publishes the version --apply writes)");
    process.exit(2);
  }
  return args;
}

function read(path: string): string {
  return readFileSync(`${ROOT}${path}`, "utf8");
}

function writeOut(name: string, value: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}${name}`, JSON.stringify(value, null, 2) + "\n");
}

/** One Retell API call. A non-2xx prints the status and body (never the key) and exits 1. */
async function retell(
  method: "POST" | "PATCH",
  path: string,
  key: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${RETELL_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${path} -> ${res.status}\n${text.slice(0, 2000)}`);
    process.exit(1);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;

  const config = buildRetellConfig({
    site: args.site,
    voiceId: args.voice,
    llm: JSON.parse(read("retell/llm.json")) as Record<string, unknown>,
    agent: JSON.parse(read("retell/agent.json")) as Record<string, unknown>,
    header: read("retell/prompt-header.md"),
    playbook: read("docs/mary-voice.md"),
    dryRun: !args.apply,
  });

  console.log(`prompt: about ${config.promptTokens} tokens`);
  for (const w of config.warnings) console.log(`warning: ${w}`);

  let llmId = env["RETELL_LLM_ID"] ?? "llm_id_set_by_apply";
  writeOut("llm.json", config.llm);
  writeOut("agent.json", config.agent(llmId));
  console.log(`wrote retell/out/llm.json and retell/out/agent.json`);

  if (!args.apply) {
    console.log("dry run: review retell/out/*.json, then rerun with --apply (and --publish)");
    return;
  }

  const key = env["RETELL_API_KEY"];
  if (!key) {
    console.error("--apply needs RETELL_API_KEY in the environment");
    process.exit(1);
  }

  if (env["RETELL_LLM_ID"]) {
    await retell("PATCH", `/update-retell-llm/${llmId}`, key, config.llm);
    console.log(`updated LLM ${llmId}`);
  } else {
    const created = await retell("POST", "/create-retell-llm", key, config.llm);
    llmId = String(created["llm_id"] ?? "");
    if (!llmId) {
      console.error("create-retell-llm returned no llm_id");
      process.exit(1);
    }
    console.log(`created LLM ${llmId}`);
  }

  const agentBody = config.agent(llmId);
  let agentId = env["RETELL_AGENT_ID"] ?? "";
  let agent: Record<string, unknown>;
  if (agentId) {
    agent = await retell("PATCH", `/update-agent/${agentId}`, key, agentBody);
    console.log(`updated agent ${agentId} (draft version ${String(agent["version"])})`);
  } else {
    agent = await retell("POST", "/create-agent", key, agentBody);
    agentId = String(agent["agent_id"] ?? "");
    if (!agentId) {
      console.error("create-agent returned no agent_id");
      process.exit(1);
    }
    console.log(`created agent ${agentId} (draft version ${String(agent["version"])})`);
  }
  const version = typeof agent["version"] === "number" ? agent["version"] : null;

  // The out/ files now carry the real ids, so what was applied can be reviewed.
  writeOut("llm.json", config.llm);
  writeOut("agent.json", agentBody);

  if (args.publish) {
    if (version === null) {
      console.error("the agent response carried no version number; publish it in the dashboard");
      process.exit(1);
    }
    await retell("POST", `/publish-agent-version/${agentId}`, key, {
      version,
      version_title: `MARY waitlist ${new Date().toISOString().slice(0, 10)}`,
    });
    console.log(`published agent ${agentId} version ${version}`);
  }

  console.log("");
  console.log(`RETELL_LLM_ID=${llmId}`);
  console.log(`RETELL_AGENT_ID=${agentId}`);
  console.log(
    `RETELL_AGENT_VERSION=${args.publish && version !== null ? version : "latest_published"}`,
  );
  console.log("");
  console.log(
    args.publish
      ? "next: set RETELL_API_KEY, RETELL_AGENT_ID (and RETELL_WEBHOOK_KEY if the webhook-badged key differs) in Lovable, VOICE_PROVIDER=retell-optin, then Publish and test with ?voice=retell (retell/README.md, go-live step 5)"
      : "next: publish the version in the Retell dashboard, or rerun with --apply --publish (retell/README.md, go-live step 3)",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
