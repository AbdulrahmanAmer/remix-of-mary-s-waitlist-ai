import { createFileRoute } from "@tanstack/react-router";

import { retellDeps } from "@/lib/retell-deps.server";
import { handleWebCall } from "@/lib/retell-handlers.server";

/** Mints a Retell web call for the browser; the API key never leaves the server. */
export const Route = createFileRoute("/api/retell/web-call")({
  server: {
    handlers: {
      POST: ({ request }) => handleWebCall(request, retellDeps(request)),
    },
  },
});
