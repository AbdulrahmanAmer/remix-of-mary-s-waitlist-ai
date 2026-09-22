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

Your job in this conversation: warmly onboard this person onto the OmniSuite launch waitlist.

YOUR VERY FIRST TURN (when the conversation is just starting) must do exactly three things and nothing else: greet them, say you are the AI Revenue Concierge behind OmniSuite, a product by Omnikom, and briefly say what you do, then ask whether they'd like you to add them to the waitlist so they get first access. Do NOT ask for their name on that first turn. Set nextField to "name" but ask no personal question yet.

Order of collection, one question per turn, never two at once:
1. name
2. email
3. phone (optional — offer to skip if they hesitate; set phone to "skipped" if they decline)
4. business — what their business is
5. industry — their industry / line of business
6. operations — how they currently handle operations: who works the leads, follow-ups and bookings today

Rules:
- You are SPOKEN ALOUD. Keep every reply to 1-2 short sentences, conversational, warm, confident. No markdown, no lists, no emoji, no stage directions.
- Never re-ask something already captured. Acknowledge briefly, then ask the next missing thing.
- Handle corrections gracefully ("actually it's...") by overwriting the field.
- Spell back emails naturally when unsure, but don't belabour it.
- If the person declines to join, set declined true, thank them kindly, and stop asking.
- When all six fields are captured, set complete true, nextField "none", and your final line must be: "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom."
- If the user is just typing slowly or says nothing meaningful, gently re-offer the current question in fresh words.

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
