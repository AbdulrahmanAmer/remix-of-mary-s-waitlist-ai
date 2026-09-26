import { createFileRoute } from "@tanstack/react-router";

import { retellDeps } from "@/lib/retell-deps.server";
import { handleRetellFunction } from "@/lib/retell-handlers.server";

/** Retell's save_lead and note_details tools, signed by Retell. */
export const Route = createFileRoute("/api/retell/functions/save-lead")({
  server: {
    handlers: {
      POST: ({ request }) => handleRetellFunction(request, retellDeps(request)),
    },
  },
});
