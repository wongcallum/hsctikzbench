import { readFile } from "node:fs/promises";
import { buildCommand, numberParser } from "@stricli/core";
import type { LocalContext } from "../context.ts";
import { runAgent } from "../loop.ts";
import { modelFlags, resolveModel, type ModelFlags } from "../model.ts";
import { OutputDir } from "../output.ts";
import { buildSystemPrompt, checkTexCapabilities } from "../prompt.ts";
import { checkContainer } from "../render.ts";

export const DEFAULT_PROMPT = new URL("../../prompt.md", import.meta.url);

/** Flags shared by every command that runs the agent. */
export interface AgentFlags extends ModelFlags {
  readonly container: string;
  readonly maxTurns: number;
  readonly prompt?: string;
}

export const agentFlags = {
  ...modelFlags,
  container: { kind: "parsed", parse: String, brief: "Name of the running renderer container" },
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

interface RunFlags extends AgentFlags {
  readonly out: string;
}

export const runCommand = buildCommand({
  async func(this: LocalContext, flags: RunFlags, reference: string): Promise<void> {
    const { models, model, authSource } = await resolveModel(flags);
    await checkContainer(flags.container);
    await checkTexCapabilities(flags.container);
    const referencePng = await readFile(reference);
    const systemPrompt = await loadSystemPrompt(flags.prompt);
    const out = new OutputDir(flags.out);
    await out.prepare(referencePng);

    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    log(`auth: ${authSource}`);
    const result = await runAgent({
      models,
      model,
      reasoning: flags.reasoning,
      container: flags.container,
      maxTurns: flags.maxTurns,
      systemPrompt,
      referencePng,
      out,
      log
    });
    this.process.stdout.write(`${result.status}\n`);
    if (result.status === "error") this.process.exitCode = 1;
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        { brief: "Path to the reference PNG", parse: String, placeholder: "reference.png" }
      ]
    },
    flags: {
      ...agentFlags,
      out: {
        kind: "parsed",
        parse: String,
        brief: "Output directory for this run"
      }
    }
  },
  docs: {
    brief: "Run the benchmark on one reference image."
  }
});
