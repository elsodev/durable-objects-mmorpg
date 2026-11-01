import { defineConfig } from "vite";

// The client is a static PixiJS app. In dev you can run `wrangler dev` (serves dist/)
// or `vite` on :5173 with /api and /ws proxied to the Worker on :8787.
export default defineConfig({
  root: "src/client",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
});
