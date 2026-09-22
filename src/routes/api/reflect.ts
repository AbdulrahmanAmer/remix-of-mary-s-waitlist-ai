import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { LEAD_OUTCOMES } from "@/lib/lead-sync";
import { reflectAndStore } from "@/lib/mary-experience.server";

const ReflectBody = z.object({
  sessionId: z.string().min(1).max(80),
  transcript: z.string().min(20).max(60_000),
  outcome: z.enum(LEAD_OUTCOMES),
  collected: z.record(z.string(), z.string()).default({}),
  mode: z.string().max(40).optional(),
  turns: z.number().int().min(0).optional(),
  durationSec: z.number().min(0).optional(),
});

/**
 * MARY's debrief after a conversation. Returns the lessons so the browser can
 * keep them locally; the same lessons are written to the sheet when connected.
 */
export const Route = createFileRoute("/api/reflect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: z.infer<typeof ReflectBody>;
        try {
          body = ReflectBody.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const outcome = await reflectAndStore(
          {
            sessionId: body.sessionId,
            transcript: body.transcript,
            outcome: body.outcome,
            collected: body.collected,
            mode: body.mode,
            turns: body.turns,
            durationSec: body.durationSec,
          },
          key,
        );
        if (!outcome) return Response.json({ ok: false, lessons: [], summary: "" });
        return Response.json({
          ok: true,
          summary: outcome.reflection.summary,
          objections: outcome.reflection.objections,
          lessons: outcome.lessons,
        });
      },
    },
  },
});
