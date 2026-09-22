import { createFileRoute } from "@tanstack/react-router";

import { LeadPayloadSchema, type LeadSyncResult } from "@/lib/lead-sync";
import { reflectAndStore } from "@/lib/mary-experience.server";
import { sheetGet, sheetPost, sheetsConfigured } from "@/lib/sheets.server";

/**
 * One row per conversation in the Google Sheet.
 *
 * POST — upsert the conversation (by session id). Called at checkpoints while
 *        the conversation runs, at the end, and as a beacon if the tab closes.
 *        With `reflect: true` MARY also debriefs the conversation here, which
 *        is how lessons still get written when nobody is left on the page.
 * GET  — connection status for the owner view.
 */
export const Route = createFileRoute("/api/lead")({
  server: {
    handlers: {
      GET: async () => {
        if (!sheetsConfigured()) return Response.json({ configured: false });
        try {
          const ping = await sheetGet<{ leads: number; lessons: number; version: string }>(
            "ping",
            {},
            { timeoutMs: 6000 },
          );
          return Response.json({
            configured: true,
            reachable: true,
            leads: ping.leads,
            lessons: ping.lessons,
            version: ping.version,
          });
        } catch (error) {
          return Response.json({
            configured: true,
            reachable: false,
            error: error instanceof Error ? error.message : "unreachable",
          });
        }
      },
      POST: async ({ request }) => {
        // Beacons arrive as text/plain; ordinary calls as JSON. Both are JSON text.
        let payload;
        try {
          payload = LeadPayloadSchema.parse(JSON.parse(await request.text()));
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const result: LeadSyncResult = {
          configured: sheetsConfigured(),
          saved: false,
          position: null,
        };
        if (result.configured) {
          try {
            const saved = await sheetPost<{ position: number | null }>(
              "lead",
              { ...payload, reflect: undefined },
              { timeoutMs: 9000 },
            );
            result.saved = true;
            result.position = typeof saved.position === "number" ? saved.position : null;
          } catch (error) {
            const message = error instanceof Error ? error.message : "sheet error";
            console.error(`[mary] lead sync failed: ${message}`);
            result.error = message;
          }
        }

        // Debrief on the server when asked — used when the page is going away
        // and nobody will be around to receive the lessons.
        const key = process.env["LOVABLE_API_KEY"];
        if (payload.reflect && key && payload.turns >= 2 && payload.transcript) {
          await reflectAndStore(
            {
              sessionId: payload.sessionId,
              transcript: payload.transcript,
              outcome: payload.outcome,
              collected: {
                name: payload.name,
                email: payload.email,
                phone: payload.phone,
                business: payload.business,
                industry: payload.industry,
                operations: payload.operations,
              },
              mode: payload.mode,
              turns: payload.turns,
              durationSec: payload.durationSec,
            },
            key,
          );
        }

        return Response.json(result);
      },
    },
  },
});
