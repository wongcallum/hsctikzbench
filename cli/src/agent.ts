import { readFile } from "node:fs/promises";
import { numberParser } from "@stricli/core";
import { modelFlags, resolveModel, type ModelFlags } from "./model.ts";
import { DEFAULT_PROMPT } from "./paths.ts";
import { buildSystemPrompt, checkTexCapabilities } from "./prompt.ts";
import { createRenderer, rendererFlags, type RendererFlags } from "./renderer.ts";

export interface AgentFlags extends ModelFlags, RendererFlags {
  readonly maxTurns: number;
  readonly prompt?: string;
}

export const agentFlags = {
  ...modelFlags,
  ...rendererFlags,
  maxTurns: {
    kind: "parsed",
    parse: numberParser,
    brief: "Maximum number of model calls",
    default: "20"
  },
  prompt: {
    kind: "parsed",
    parse: String,
    brief: "Path to a system prompt file replacing the default",
    optional: true
  }
} as const;

export async function loadSystemPrompt(path: string | undefined): Promise<string> {
  return buildSystemPrompt(await readFile(path ?? DEFAULT_PROMPT, "utf8"));
}

export async function prepareAgent(flags: AgentFlags) {
  const { models, model, authSource } = await resolveModel(flags);
  const renderer = await createRenderer(flags);
  await renderer.prepare();
  await checkTexCapabilities(renderer);
  const systemPrompt = await loadSystemPrompt(flags.prompt);
  return { models, model, authSource, renderer, systemPrompt };
}
