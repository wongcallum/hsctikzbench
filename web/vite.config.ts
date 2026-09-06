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
      runsDir: env.RUNS_DIR
    })
  ]
});
