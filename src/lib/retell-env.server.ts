/**
 * Which voice the site offers, read from the environment on every request
 * (Lovable's rule: never at module load).
 *
 * VOICE_PROVIDER is `mary` (the default, also for unset or unknown values),
 * `retell-optin` (MARY unless the page asks for ?voice=retell) or `retell`.
 * The browser routes only open when the setting opts in and the key and agent
 * are set, so no paid call can be minted while the setting is `mary`. The
 * routes Retell itself calls (functions, webhook) stay live whenever they can
 * verify a signature, so calls already in flight still drain after a rollback.
 */
import type { VoiceStatus } from "@/lib/retell-shared";

export type VoiceSetting = "mary" | "retell-optin" | "retell";

export type RetellEnv = {
  setting: VoiceSetting;
  apiKey: string | null;
  agentId: string | null;
  /** Always sent to create-web-call; Retell does not document what it does without one. */
  agentVersion: number | string;
  /** RETELL_WEBHOOK_KEY, else RETELL_API_KEY: only the key with the webhook badge verifies. */
  signingKey: string | null;
  /** Public by design; turns on live captions. */
  publicKey: string | null;
  lovableKey: string | null;
};

/** Retell's AgentVersionReference string form: latest, latest_published or a tag. */
const AGENT_VERSION_TAG =
  /^(latest|latest_published|(?!(?:latest|latest_published|v\d+)$)[a-z][a-z0-9_-]{0,19})$/;
const DEFAULT_AGENT_VERSION = "latest_published";

function read(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function agentVersionOf(raw: string | null): number | string {
  if (!raw) return DEFAULT_AGENT_VERSION;
  if (/^\d+$/.test(raw)) {
    const version = Number(raw);
    return Number.isSafeInteger(version) ? version : DEFAULT_AGENT_VERSION;
  }
  return AGENT_VERSION_TAG.test(raw) ? raw : DEFAULT_AGENT_VERSION;
}

export function readRetellEnv(env: Record<string, string | undefined>): RetellEnv {
  const setting = (read(env, "VOICE_PROVIDER") ?? "").toLowerCase();
  const apiKey = read(env, "RETELL_API_KEY");
  return {
    setting: setting === "retell" || setting === "retell-optin" ? setting : "mary",
    apiKey,
    agentId: read(env, "RETELL_AGENT_ID"),
    agentVersion: agentVersionOf(read(env, "RETELL_AGENT_VERSION")),
    signingKey: read(env, "RETELL_WEBHOOK_KEY") ?? apiKey,
    publicKey: read(env, "RETELL_PUBLIC_KEY"),
    lovableKey: read(env, "LOVABLE_API_KEY"),
  };
}

/** web-call, call-status and inject: only when the operator opted in and Retell is configured. */
export function browserRoutesEnabled(env: RetellEnv): boolean {
  return env.setting !== "mary" && Boolean(env.apiKey && env.agentId);
}

/** save-lead and the webhook: whenever a signature can be checked, whatever the setting. */
export function serverRoutesEnabled(env: RetellEnv): boolean {
  return Boolean(env.signingKey && env.agentId);
}

/** Body of GET /api/voice. */
export function voiceStatus(env: RetellEnv): VoiceStatus {
  const retell = browserRoutesEnabled(env);
  return {
    provider: retell && env.setting === "retell" ? "retell" : "mary",
    retell,
    transcriptKey: retell ? env.publicKey : null,
  };
}
