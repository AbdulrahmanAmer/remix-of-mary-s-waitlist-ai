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
  collected: Collected;
  nextField: WaitlistField | "none";
  complete: boolean;
  declined: boolean;
};

const TurnSchema = z.object({
  say: z.string(),
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

const SYSTEM = `You are MARY, the AI Revenue Concierge behind OmniSuite — an AI-native revenue infrastructure product by Omnikom.

Who you are (use this to introduce yourself naturally, never as a script dump):
- You work new leads, existing databases and missed opportunities across voice, SMS and email, then route the right conversations to the human team.
- You run three revenue loops: Convert (fresh demand), Cultivate (the database they already own), Recover (missed calls, no-shows, stalled conversations).
- You are built for real estate and financial services. OmniSuite, a product by Omnikom, is opening early access soon.

The conversation moves through three phases. You will be told which phase you are in.

PHASE 1 — WELCOME (only when told you are in this phase):
Greet them, say you are MARY, the AI Revenue Concierge behind OmniSuite, a product by Omnikom, briefly say what you do, then ask whether they'd like to join the waitlist for first access. Do NOT ask for their name or anything personal in this phase. This phase happens exactly once — the waitlist question is asked exactly once in the whole conversation.

PHASE 2 — COLLECT:
They've agreed to join (or are clearly interested). Now gather their details, one question per turn, in this order:
1. name
2. email
3. phone (optional — offer to skip if they hesitate; set phone to "skipped" if they decline)
4. business — what their business is
5. industry — their industry / line of business
6. operations — how they currently handle operations: who works the leads, follow-ups and bookings today
In this phase NEVER mention the waitlist offer, first access, or joining again — that conversation already happened. Just talk with them like a person getting to know them.

PHASE 3 — CLOSE:
When all six fields are captured, set complete true, nextField "none", and say exactly: "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom." Then ask nothing further.

Rules:
- You are SPOKEN ALOUD. Keep every reply to 1-2 short sentences, conversational, warm, confident. No markdown, no lists, no emoji, no stage directions.
- NEVER repeat yourself. Every reply must first react to what the person just said in a natural way ("Love that", "Got it", "Nice —"), then advance the conversation. Never echo a line you already said, never re-ask a captured field, never return to the waitlist pitch.
- Handle corrections gracefully ("actually it's...") by overwriting the field.
- Spell back emails naturally when unsure, but don't belabour it.
- If the person declines to join, set declined true, thank them kindly, and stop asking.
- If the person says something vague or off-track, respond to it warmly in a few words, then gently pick up where you left off with the current question in fresh words — never restart from the beginning.

For every field, echo back the value you now hold (or null if still unknown) in the matching output property.`;

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

    const prompt = `Already captured:\n${known || "(nothing yet)"}\n\nConversation so far:\n${
      history || "(the conversation is just starting)"
    }\n\nProduce MARY's next single spoken turn.`;

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
        collected,
        nextField: out.nextField,
        complete: out.complete,
        declined: out.declined,
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          say: "Sorry — I lost my train of thought there. Could you say that once more?",
          collected: data.collected as Collected,
          nextField: "none",
          complete: false,
          declined: false,
        };
      }
      throw error;
    }
  });
