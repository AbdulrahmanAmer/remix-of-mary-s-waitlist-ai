import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output } from "ai";
import { z } from "zod";
import { SYSTEM, TurnSchema, buildPrompt, gatewayConfig } from "@/lib/mary-prompt.server";

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  collected: z.record(z.string(), z.string()).default({}),
});

/**
 * Streams MARY's turn as it is written, so her first beat can start playing
 * while the rest of the turn is still being generated.
 *
 * Emits newline-delimited JSON:
 *   { "type": "say", "text": "..." }    — the first beat, final
 *   { "type": "turn", "turn": { ... } } — the complete turn
 *   { "type": "error" }
 */
export const Route = createFileRoute("/api/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let data: z.infer<typeof Body>;
        try {
          data = Body.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const lovable = createOpenAI(gatewayConfig(key));
        const result = streamText({
          model: lovable.responses("openai/gpt-6-astra"),
          system: SYSTEM,
          prompt: buildPrompt(data.messages, data.collected),
          output: Output.object({ schema: TurnSchema }),
          providerOptions: {
            openai: { forceReasoning: true, reasoningEffort: "low", store: false },
          },
        });

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (payload: unknown) =>
              controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
            let saidSent = false;
            try {
              for await (const partial of result.partialOutputStream) {
                const part = partial as Partial<z.infer<typeof TurnSchema>>;
                // Once the next key starts arriving, "say" is final — send it
                // straight away so speech can begin.
                const sayDone =
                  typeof part.say === "string" &&
                  part.say.trim().length > 0 &&
                  (part.followUp !== undefined || part.nextField !== undefined);
                if (!saidSent && sayDone) {
                  saidSent = true;
                  send({ type: "say", text: part.say!.trim() });
                }
              }
              const out = await result.output;
              if (!saidSent) send({ type: "say", text: out.say.trim() });
              send({ type: "turn", turn: out });
            } catch (error) {
              console.error("turn stream failed", error);
              send({ type: "error" });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
