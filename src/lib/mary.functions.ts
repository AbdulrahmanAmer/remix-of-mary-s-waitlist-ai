import { createServerFn } from "@tanstack/react-start";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

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

/**
 * Non-streaming fallback. The live conversation uses /api/turn, which streams
 * the first beat out as soon as it is written; this keeps a working path for
 * environments where streaming is unavailable.
 */
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

    const { SYSTEM, TurnSchema, buildPrompt, gatewayConfig } = await import("./mary-prompt.server");
    const lovable = createOpenAI(gatewayConfig(key));

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        prompt: buildPrompt(data.messages, data.collected),
        output: Output.object({ schema: TurnSchema }),
        providerOptions: {
          openai: { forceReasoning: true, reasoningEffort: "low", store: false },
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
