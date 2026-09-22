import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output } from "ai";
import { z } from "zod";
import { gatewayConfig } from "@/lib/mary-prompt.server";

/**
 * Who was that for?
 *
 * The line stays open the whole call, so the microphone hears the room as well
 * as the person. Before MARY reacts to anything, this decides — from the words
 * alone, against what she just said — whether it was addressed to her, whether
 * it was the room talking among themselves, or whether the person is mid-
 * sentence and she should simply keep waiting.
 */
const VerdictSchema = z.object({
  verdict: z.enum(["mary", "ambient", "unfinished"]),
});

const Body = z.object({
  heard: z.string().min(1),
  lastAssistant: z.string(),
  recent: z.array(z.string()).max(6),
});

const SYSTEM = `You are the turn-taking judge on a live voice call between a person and MARY, an AI assistant.
You are given one stretch of speech the microphone picked up.
Answer with exactly one verdict:
- "mary": the person is speaking to MARY — an answer, a question, a reaction, a correction, even a single word like "yes", "no", "hold on".
- "ambient": it is other people nearby, background chatter, a TV, or someone talking about something unrelated to the conversation. Speech that does not fit the conversation at all is ambient.
- "unfinished": it is clearly the person talking to MARY but cut short mid-thought, so she should wait rather than answer.
Prefer "mary" when it plausibly answers or follows MARY's last line. Prefer "ambient" only when it does not belong to this conversation.`;

export const Route = createFileRoute("/api/addressee")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return Response.json({ verdict: "mary" });

        let data: z.infer<typeof Body>;
        try {
          data = Body.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        try {
          const lovable = createOpenAI(gatewayConfig(key));
          const result = streamText({
            model: lovable.responses("openai/gpt-6-astra"),
            system: SYSTEM,
            prompt: [
              `MARY just said: ${data.lastAssistant || "(nothing yet)"}`,
              data.recent.length ? `Recent conversation:\n${data.recent.join("\n")}` : "",
              `Heard: ${data.heard}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            output: Output.object({ schema: VerdictSchema }),
            providerOptions: {
              openai: { forceReasoning: true, reasoningEffort: "low", store: false },
            },
            // A slow judgement must never hold the call up — she assumes it was
            // for her rather than leaving someone hanging.
            abortSignal: AbortSignal.timeout(4000),
          });
          const out = await result.output;
          return Response.json(out, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("addressee judgement failed", error);
          return Response.json({ verdict: "mary" });
        }
      },
    },
  },
});
