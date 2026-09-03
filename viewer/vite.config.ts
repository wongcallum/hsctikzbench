import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { runsPlugin } from "./plugin/runs.ts";

const DEFAULT_RUNS_DIR = fileURLToPath(new URL("../data/runs", import.meta.url));

export default defineConfig({
  plugins: [react(), runsPlugin(process.env["RUNS_DIR"] ?? DEFAULT_RUNS_DIR)]
});
