import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { rubricPlugin } from "./plugin/rubric.ts";

const DEFAULT_MANIFEST = fileURLToPath(new URL("../dataset/manifest.json", import.meta.url));
const DEFAULT_CROPS_DIR = fileURLToPath(new URL("../data/crops", import.meta.url));
const DEFAULT_AUTH = fileURLToPath(new URL("../cli/auth.json", import.meta.url));
const DEFAULT_PROMPT = fileURLToPath(new URL("./prompt.md", import.meta.url));

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      `rubric: set ${name} (PROVIDER and MODEL are required; REASONING, AUTH, MANIFEST, CROPS_DIR, PROMPT are optional)`
    );
  }
  return value;
}

export default defineConfig({
  plugins: [
    react(),
    rubricPlugin({
      manifest: process.env["MANIFEST"] ?? DEFAULT_MANIFEST,
      cropsDir: process.env["CROPS_DIR"] ?? DEFAULT_CROPS_DIR,
      prompt: process.env["PROMPT"] ?? DEFAULT_PROMPT,
      model: {
        provider: required("PROVIDER"),
        model: required("MODEL"),
        reasoning: process.env["REASONING"] ?? "off",
        auth: process.env["AUTH"] ?? DEFAULT_AUTH
      }
    })
  ]
});
