import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiPlugin } from "./plugin/api.ts";

const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const env = (name: string, fallback: string) => process.env[name] ?? fallback;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`web: ${name} is required when PROVIDER is set`);
  return value;
}

export default defineConfig({
  plugins: [
    react(),
    apiPlugin({
      manifest: env("MANIFEST", local("../dataset/manifest.json")),
      cropsDir: env("CROPS_DIR", local("../data/crops")),
      runsDir: env("RUNS_DIR", local("../data/runs")),
      prompt: env("PROMPT", local("./prompt.md")),
      // Drafting is enabled only when a provider is configured.
      model: process.env["PROVIDER"]
        ? {
            provider: required("PROVIDER"),
            model: required("MODEL"),
            reasoning: env("REASONING", "off"),
            auth: env("AUTH", local("../cli/auth.json"))
          }
        : null
    })
  ]
});
