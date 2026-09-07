import { readFile } from "node:fs/promises";
import { buildCommand } from "@stricli/core";
import { agentFlags, prepareAgent, type AgentFlags } from "../agent.ts";
import type { LocalContext } from "../context.ts";
import { runAgent } from "../loop.ts";
import { OutputDir } from "../output.ts";

interface RunFlags extends AgentFlags {
  readonly out: string;
}

export const runCommand = buildCommand({
  async func(this: LocalContext, flags: RunFlags, reference: string): Promise<void> {
    const { models, model, authSource, renderer, systemPrompt } = await prepareAgent(flags);
    const referencePng = await readFile(reference);
    const out = new OutputDir(flags.out);
    await out.prepare(referencePng);

    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    log(`auth: ${authSource}`);
    log(`renderer: ${renderer.description}`);
    const result = await runAgent({
      models,
      model,
      reasoning: flags.reasoning,
      renderer,
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
