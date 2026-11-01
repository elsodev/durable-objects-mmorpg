import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// vite.config.ts roots Vite at src/client for the browser build; tests live in test/ at the
// repo root, so vitest gets its own config (this file takes precedence over vite.config.ts).
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    // Durable Object classes extend cloudflare:workers' DurableObject; tests run them against a fake ctx.
    alias: { "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)) },
  },
});
