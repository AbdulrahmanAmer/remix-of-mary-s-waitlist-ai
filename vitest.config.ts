// Standalone on purpose: vite.config.ts pulls in the TanStack Start / Nitro / Cloudflare plugin
// stack, which unit tests of pure logic do not need.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
