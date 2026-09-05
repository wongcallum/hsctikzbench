import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { env } from "./env.ts";
import { apiPlugin } from "./plugin/api.ts";

export default defineConfig({
  plugins: [
    react(),
    apiPlugin({
      manifest: env.MANIFEST,
      cropsDir: env.CROPS_DIR,
      runsDir: env.RUNS_DIR,
      prompt: env.PROMPT,
      // Drafting is enabled only when a provider is configured.
      model: env.PROVIDER
        ? {
            provider: env.PROVIDER,
            model:
              env.MODEL ??
              (() => {
                throw new Error("web: MODEL is required when PROVIDER is set");
              })(),
            reasoning: env.REASONING,
            auth: env.AUTH
          }
        : null
    })
  ]
});
