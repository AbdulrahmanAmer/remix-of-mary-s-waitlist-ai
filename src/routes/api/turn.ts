import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output } from "ai";
import type { z } from "zod";
import {
  SYSTEM,
  TurnSchema,
  buildPrompt,
  finishTurn,
  gatewayConfig,
} from "@/lib/mary-prompt.server";
import { experienceForTurn } from "@/lib/mary-experience.server";
import { TurnInput } from "@/lib/mary.functions";

/** The whole generation, reasoning included, must finish within this. */
const TURN_DEADLINE_MS = 30000;

/**
 * Streams MARY's turn as it is written, so her first beat can start playing
 * while the rest of the turn is still being generated.
 *
 * Emits newline-delimited JSON:
 *   { "type": "say", "text": "..." }    — the first beat, final
 *   { "type": "turn", "turn": { ... } } — the complete, grounded turn
 *   { "type": "error" }
 */
export const Route = createFileRoute("/api/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let data: z.infer<typeof TurnInput>;
        try {
          data = TurnInput.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        // What she has learned so far rides into the prompt — bounded by a
        // short budget so a slow sheet can never delay her reply.
        const experience = await experienceForTurn(data.experience, data.collected["industry"]);

        // A model that goes quiet must not hold the conversation hostage, and a
        // browser that gave up on this turn (a newer message, a hold) must not
        // keep paying for it: both end the generation.
        const abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), TURN_DEADLINE_MS);
        const lovable = createOpenAI(gatewayConfig(key));
        const result = streamText({
          model: lovable.responses("openai/gpt-6-astra"),
          system: SYSTEM,
          prompt: buildPrompt(data.messages, data.collected, data.flags, experience),
          output: Output.object({ schema: TurnSchema }),
          providerOptions: {
            openai: { forceReasoning: true, reasoningEffort: "low", store: false },
          },
          abortSignal: abort.signal,
        });

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          cancel() {
            clearTimeout(deadline);
            abort.abort();
          },
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
                  (part.followUp !== undefined || part.name !== undefined);
                if (!saidSent && sayDone) {
                  saidSent = true;
                  send({ type: "say", text: part.say!.trim() });
                }
              }
              const out = await result.output;
              if (!saidSent) send({ type: "say", text: out.say.trim() });
              const turn = finishTurn(out, data);
              if (turn.rejected.length && process.env["NODE_ENV"] !== "production") {
                console.info("[mary] ungrounded fields dropped:", turn.rejected.join(", "));
              }
              send({ type: "turn", turn });
            } catch (error) {
              console.error("turn stream failed", error);
              send({ type: "error" });
            } finally {
              clearTimeout(deadline);
              try {
                controller.close();
              } catch {
                // already cancelled by the client
              }
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
