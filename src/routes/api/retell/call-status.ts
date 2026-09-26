import { createFileRoute } from "@tanstack/react-router";

import { retellDeps } from "@/lib/retell-deps.server";
import { handleCallStatus } from "@/lib/retell-handlers.server";

/** The browser's own call: status and recorded progress. A POST so the guard rate-limits it. */
export const Route = createFileRoute("/api/retell/call-status")({
  server: {
    handlers: {
      POST: ({ request }) => handleCallStatus(request, retellDeps(request)),
    },
  },
});
