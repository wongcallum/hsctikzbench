import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { runsPlugin } from "./plugin/runs.ts";

const DEFAULT_RUNS_DIR = fileURLToPath(new URL("../data/runs", import.meta.url));
const DEFAULT_MANIFEST = fileURLToPath(new URL("../dataset/manifest.json", import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    runsPlugin({
      runsDir: process.env["RUNS_DIR"] ?? DEFAULT_RUNS_DIR,
      manifest: process.env["MANIFEST"] ?? DEFAULT_MANIFEST
    })
  ]
});
