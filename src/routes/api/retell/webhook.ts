import { createFileRoute } from "@tanstack/react-router";

import { retellDeps } from "@/lib/retell-deps.server";
import { handleWebhook } from "@/lib/retell-handlers.server";

/** Retell's call_ended / call_analyzed deliveries, signed by Retell: the backstop row and the debrief. */
export const Route = createFileRoute("/api/retell/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleWebhook(request, retellDeps(request)),
    },
  },
});
