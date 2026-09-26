import { createFileRoute } from "@tanstack/react-router";

import { retellDeps } from "@/lib/retell-deps.server";
import { handleInject } from "@/lib/retell-handlers.server";

/** Typed text during a Retell call, passed to the agent. */
export const Route = createFileRoute("/api/retell/inject")({
  server: {
    handlers: {
      POST: ({ request }) => handleInject(request, retellDeps(request)),
    },
  },
});
