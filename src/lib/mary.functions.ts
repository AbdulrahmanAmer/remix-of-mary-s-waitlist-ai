import { createServerFn } from "@tanstack/react-start";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
// MARY's personality and behaviour live in one document; the app reads it
// directly so the spec and her actual behaviour can never drift apart.
import MARY_VOICE_SPEC from "../../docs/mary-voice.md?raw";

export const WAITLIST_FIELDS = [
  "name",
  "email",
  "phone",
  "business",
  "industry",
  "operations",
] as const;

export type WaitlistField = (typeof WAITLIST_FIELDS)[number];

export type Collected = Partial<Record<WaitlistField, string>>;

export type MaryTurn = {
  say: string;
  followUp: string | null;
  collected: Collected;
  nextField: WaitlistField | "none";
  complete: boolean;
  declined: boolean;
};

const TurnSchema = z.object({
  say: z.string(),
  followUp: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  business: z.string().nullable(),
  industry: z.string().nullable(),
  operations: z.string().nullable(),
  nextField: z.enum(["name", "email", "phone", "business", "industry", "operations", "none"]),
  complete: z.boolean(),
  declined: z.boolean(),
});

const SYSTEM = MARY_VOICE_SPEC;

export const maryTurn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
        collected: z.record(z.string(), z.string()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<MaryTurn> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    const history = data.messages
      .map((m) => `${m.role === "user" ? "Person" : "MARY"}: ${m.content}`)
      .join("\n");

    const known = Object.entries(data.collected)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const capturedCount = WAITLIST_FIELDS.filter((f) => (data.collected as Collected)[f]).length;
    const allCaptured = capturedCount >= WAITLIST_FIELDS.length;
    const lastAssistant = [...data.messages].reverse().find((m) => m.role === "assistant")?.content;
    // The wrap question has already gone out if MARY's last line asked something
    // once everything was captured — only then may she close.
    const wrapAsked = Boolean(lastAssistant && lastAssistant.includes("?"));
    const phase = !history
      ? "WELCOME — the conversation is just starting; this is your one and only welcome."
      : allCaptured
        ? wrapAsked
          ? "CLOSE — they've answered your wrap question. Answer anything they asked in one sentence, then deliver the closing line and set complete true."
          : "WRAP — everything is captured, but do NOT close yet. Tell them they're all set and ask if they have questions or want you to finalise their spot. Keep complete false."
        : "COLLECT — the welcome already happened. Do NOT mention the waitlist offer or first access again. Acknowledge what they just said, then ask the next missing detail.";

    const prompt = `Current phase: ${phase}\n\nAlready captured:\n${known || "(nothing yet)"}\n\nConversation so far:\n${
      history || "(the conversation is just starting)"
    }\n\nProduce MARY's next spoken turn as two beats: "say" reacts to them first, "followUp" asks the one next thing (or null). Neither beat may repeat anything you already said.`;

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        prompt,
        output: Output.object({ schema: TurnSchema }),
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            store: false,
          },
        },
      });

      const out = await result.output;
      const collected: Collected = { ...(data.collected as Collected) };
      for (const field of WAITLIST_FIELDS) {
        const value = out[field];
        if (value && value.trim()) collected[field] = value.trim();
      }

      return {
        say: out.say.trim(),
        followUp: out.followUp?.trim() ? out.followUp.trim() : null,
        collected,
        nextField: out.nextField,
        complete: out.complete,
        declined: out.declined,
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          say: "Sorry — I lost my train of thought there. Could you say that once more?",
          followUp: null,
          collected: data.collected as Collected,
          nextField: "none",
          complete: false,
          declined: false,
        };
      }
      throw error;
    }
  });
