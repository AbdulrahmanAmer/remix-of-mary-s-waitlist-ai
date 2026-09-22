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

/** What MARY has actually finished saying — beats she was cut off in don't count. */
export type TurnFlags = {
  revealed: boolean;
  lanesDone: boolean;
  /** The wrap question has been asked, so CLOSE is reachable. */
  wrapAsked?: boolean;
  /** They asked for a callback; the sales sequence is over. */
  callback?: boolean;
  /** How they are showing up, carried between turns. */
  mode?: "neutral" | "rushed" | "skeptical" | "guarded" | "warm";
};

/** What the person's last message was actually doing, read before the funnel. */
export const TURN_INTENTS = [
  "greeting",
  "answering",
  "asking",
  "correcting",
  "objecting",
  "callback",
  "refusing",
  "leaving",
  "smalltalk",
] as const;
export type TurnIntent = (typeof TURN_INTENTS)[number];

export type MaryTurn = {
  say: string;
  followUp: string | null;
  collected: Collected;
  nextField: WaitlistField | "none";
  complete: boolean;
  declined: boolean;
  /** They asked to be called back instead of finishing here. */
  callbackRequested: boolean;
  intent: TurnIntent;
  /** She asked the wrap question this turn — no punctuation guessing. */
  wrapAsked: boolean;
  revealed: boolean;
  lanesDone: boolean;
  /** Fields the model proposed without the person's words to back them. */
  rejected: string[];
};

export const TurnInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  collected: z.record(z.string(), z.string()).default({}),
  flags: z
    .object({ revealed: z.boolean(), lanesDone: z.boolean() })
    .default({ revealed: false, lanesDone: false }),
});

export type TurnInputData = z.infer<typeof TurnInput>;

/**
 * Non-streaming fallback. The live conversation uses /api/turn, which streams
 * the first beat out as soon as it is written; this keeps a working path for
 * environments where streaming is unavailable.
 */
export const maryTurn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TurnInput.parse(input))
  .handler(async ({ data }): Promise<MaryTurn> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { SYSTEM, TurnSchema, buildPrompt, finishTurn, gatewayConfig } =
      await import("./mary-prompt.server");
    const lovable = createOpenAI(gatewayConfig(key));

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        prompt: buildPrompt(data.messages, data.collected, data.flags),
        output: Output.object({ schema: TurnSchema }),
        providerOptions: {
          openai: { forceReasoning: true, reasoningEffort: "low", store: false },
        },
      });

      const out = await result.output;
      return finishTurn(out, data);
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          say: "Sorry — I lost my train of thought there. Could you say that once more?",
          followUp: null,
          collected: data.collected as Collected,
          nextField: "none",
          complete: false,
          declined: false,
          callbackRequested: false,
          intent: "answering",
          wrapAsked: false,
          revealed: data.flags.revealed,
          lanesDone: data.flags.lanesDone,
          rejected: [],
        };
      }
      throw error;
    }
  });
