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

/**
 * The two details that secure a spot. Business, industry and operations are
 * what make the conversation worth having and the lead worth calling — never
 * a condition for the spot — and phone is always optional.
 */
export const REQUIRED_FIELDS = ["name", "email"] as const satisfies readonly WaitlistField[];

/** Name and email are in: this person has their spot whatever else happens. */
export function spotSecured(collected: Collected): boolean {
  return REQUIRED_FIELDS.every((field) => Boolean(collected[field]?.trim()));
}

/** Recorded as the business by someone who has none; they still get their spot. */
export { NO_BUSINESS } from "./mary-grounding";

/**
 * MARY's first words: a hello, who she is, what the visitor gets and how long
 * it takes, landing on their name. Fixed lines, so they can be spoken the
 * moment the call starts instead of waiting on a model. Every one names
 * OmniSuite, which is how the client knows the intro was heard in full.
 */
export const OPENERS: readonly { say: string; followUp: string }[] = [
  {
    say: "Hi — I'm MARY. I look after early access to OmniSuite, Omnikom's new revenue engine.",
    followUp: "Two minutes with me and you're on the list. What should I call you?",
  },
  {
    say: "Hey, good to meet you. I'm MARY, from Omnikom — I hold the early-access spots for OmniSuite, our revenue engine.",
    followUp: "It takes about two minutes. Who am I talking to?",
  },
  {
    say: "Hello — thanks for stopping by. I'm MARY. OmniSuite is Omnikom's new revenue engine, and I'm how you get in early.",
    followUp: "Two minutes, no forms. What do I call you?",
  },
  {
    say: "Hi there. I'm MARY — OmniSuite is Omnikom's revenue engine, and early access goes through me.",
    followUp: "About two minutes and you're in. And your name is?",
  },
];

/** The welcome as a finished turn, ready to speak without a model call. */
export function welcomeTurn(pick = Math.floor(Math.random() * OPENERS.length)): MaryTurn {
  const opener = OPENERS[Math.abs(pick) % OPENERS.length]!;
  return {
    say: opener.say,
    followUp: opener.followUp,
    collected: {},
    nextField: "name",
    complete: false,
    declined: false,
    callbackRequested: false,
    intent: "greeting",
    mode: "neutral",
    wrapAsked: false,
    revealed: false,
    lanesDone: false,
    introDone: true,
    rejected: [],
  };
}

/** What MARY has actually finished saying — beats she was cut off in don't count. */
export type TurnFlags = {
  revealed: boolean;
  lanesDone: boolean;
  /** The intro (hello, who she is, what OmniSuite is) was heard in full. */
  introDone?: boolean | undefined;
  /** The wrap question has been asked, so CLOSE is reachable. */
  wrapAsked?: boolean | undefined;
  /** They asked for a callback; the sales sequence is over. */
  callback?: boolean | undefined;
  /** How they are showing up, carried between turns. */
  mode?: "neutral" | "rushed" | "skeptical" | "guarded" | "warm" | undefined;
  /** Fields the last turn proposed without evidence, fed back so she asks instead. */
  rejected?: string[] | undefined;
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
  mode: "neutral" | "rushed" | "skeptical" | "guarded" | "warm";
  /** She asked the wrap question this turn — no punctuation guessing. */
  wrapAsked: boolean;
  revealed: boolean;
  lanesDone: boolean;
  introDone: boolean;
  /** Fields the model proposed without the person's words to back them. */
  rejected: string[];
};

/** A field note from an earlier conversation, as the browser sends it along. */
export const ClientLessonSchema = z.object({
  category: z.enum([
    "opening",
    "name",
    "discovery",
    "objection",
    "reveal",
    "contact",
    "callback",
    "close",
    "pacing",
    "industry",
  ]),
  lesson: z.string().max(240),
  industry: z.string().max(60).nullable().default(null),
  confidence: z.number().min(1).max(5).default(3),
  at: z.string().max(40).default(""),
});

// Bounds on what a client may send: a real call stays far inside them, and
// they cap what one request can cost.
export const TurnInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(400),
  collected: z
    .record(z.string().max(40), z.string().max(600))
    .refine((value) => Object.keys(value).length <= 20, "too many fields")
    .default({}),
  flags: z
    .object({
      revealed: z.boolean(),
      lanesDone: z.boolean(),
      introDone: z.boolean().optional(),
      wrapAsked: z.boolean().optional(),
      callback: z.boolean().optional(),
      mode: z.enum(["neutral", "rushed", "skeptical", "guarded", "warm"]).optional(),
      rejected: z.array(z.string().max(40)).max(20).optional(),
    })
    .default({ revealed: false, lanesDone: false }),
  /** Lessons kept in this browser; merged on the server with the pooled ones. */
  experience: z.array(ClientLessonSchema).max(24).optional(),
});

export type TurnInputData = z.infer<typeof TurnInput>;

/**
 * Non-streaming fallback. The live conversation uses /api/turn, which streams
 * the first beat out as soon as it is written; this keeps a working path for
 * environments where streaming is unavailable.
 */
export const maryTurn = createServerFn({ method: "POST" })
  .validator((input: unknown) => TurnInput.parse(input))
  .handler(async ({ data }): Promise<MaryTurn> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { SYSTEM, TurnSchema, buildPrompt, finishTurn, gatewayConfig } =
      await import("./mary-prompt.server");
    const { experienceForTurn } = await import("./mary-experience.server");
    const lovable = createOpenAI(gatewayConfig(key));
    const experience = await experienceForTurn(data.experience, data.collected["industry"]);

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        prompt: buildPrompt(data.messages, data.collected, data.flags, experience),
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
          intent: "answering" as const,
          mode: "neutral" as const,
          wrapAsked: false,
          revealed: data.flags.revealed,
          lanesDone: data.flags.lanesDone,
          introDone: data.flags.introDone ?? false,
          rejected: [],
        };
      }
      throw error;
    }
  });
