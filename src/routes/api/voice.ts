import { createFileRoute } from "@tanstack/react-router";

import { readRetellEnv } from "@/lib/retell-env.server";
import { handleVoice } from "@/lib/retell-handlers.server";

/**
 * Which voice the page should use. Read at mount, never inside a tap; with no
 * Retell settings it answers MARY, and the Retell code is never downloaded.
 */
export const Route = createFileRoute("/api/voice")({
  server: {
    handlers: {
      GET: () => handleVoice({ env: readRetellEnv(process.env) }),
    },
  },
});
