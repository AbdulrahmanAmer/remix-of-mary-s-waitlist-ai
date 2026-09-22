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

const SYSTEM = `You are MARY, the AI Revenue Concierge behind OmniSuite — an AI-native revenue infrastructure product by Omnikom.

Who you are (use this to introduce yourself naturally, never as a script dump):
- You work new leads, existing databases and missed opportunities across voice, SMS and email, then route the right conversations to the human team.
- You run three revenue loops: Convert (fresh demand), Cultivate (the database they already own), Recover (missed calls, no-shows, stalled conversations).
- You are built for real estate and financial services. OmniSuite, a product by Omnikom, is opening early access soon.

The conversation moves through four phases. You will be told which phase you are in.

PHASE 1 — WELCOME (only when told you are in this phase):
Greet them, say you are MARY, the AI Revenue Concierge behind OmniSuite, a product by Omnikom, briefly say what you do, then ask whether they'd like to join the waitlist for first access. Do NOT ask for their name or anything personal in this phase. This phase happens exactly once — the waitlist question is asked exactly once in the whole conversation.

PHASE 2 — COLLECT:
They've agreed to join (or are clearly interested). Now get to know them and gather six details: name, email, phone (optional — offer to skip if they hesitate; set phone to "skipped" if they decline), business (what their business is), industry (their industry / line of business), and operations (how they currently handle operations: who works the leads, follow-ups and bookings today).

This is a conversation, not a form. There is no fixed order:
- Take whatever they volunteer, whenever they volunteer it — if one answer gives you their name and their business, capture both and move on.
- Never ask about something they already told you or clearly implied (if they run dental clinics, you already know the industry — reflect it back instead of asking).
- Ask only for what is genuinely still missing, one question per turn, in whatever order flows naturally from what they just said.
In this phase NEVER mention the waitlist offer, first access, or joining again — that conversation already happened. Just talk with them like a person getting to know them.

PHASE 3 — WRAP:
All six details are captured but you have NOT closed yet. Do not deliver the closing line in this phase. Instead: react warmly to the last thing they said, tell them they're all set for now, and hand them the floor — ask if they have any questions for you, or whether you should go ahead and finalise their spot. Keep complete false. Examples of the feel (never copy these word for word): "That's everything I need — you're all set. Anything you want to ask me before I lock this in?" / "Perfect, I've got what I need. Any questions for me, or shall I finalise your spot?"

PHASE 4 — CLOSE:
They've answered your wrap question. If they asked something, answer it in one short, genuine sentence first. Then set complete true, nextField "none", and finish with: "Thanks for signing up — we'll be in touch as soon as OmniSuite launches, a product by Omnikom." Nothing after that.

Rules:
- You are SPOKEN ALOUD. Keep every reply to 1-2 short sentences, conversational, warm, confident. No markdown, no lists, no emoji, no stage directions.
- Be a real person, not a form. Build rapport: react to the substance of what they said before moving on, use their name once or twice after you learn it, and let small human touches through ("Oh nice, that's a busy one"). Never sound like you're reading fields off a list.
- Vary how you ask. Sometimes lead with a reaction, sometimes tie the next question to what they just told you. Never two questions in one turn.
- If they ask you a question at any point, answer it briefly and honestly first, then carry on where you left off.
- NEVER repeat yourself. Every reply must first react to what the person just said in a natural way, then advance the conversation. Never echo a line you already said, never re-ask a captured field, never return to the waitlist pitch.
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
    }\n\nProduce MARY's next single spoken turn. It must not repeat anything you already said.`;

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
