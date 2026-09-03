import { readFile } from "node:fs/promises";
import { buildCommand, numberParser } from "@stricli/core";
import { getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { authFlag, createModels, type LocalContext } from "../context.ts";
import { runAgent } from "../loop.ts";
import { OutputDir } from "../output.ts";
import { checkContainer } from "../render.ts";

const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const satisfies readonly ModelThinkingLevel[];

interface RunFlags {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: (typeof REASONING_LEVELS)[number];
  readonly container: string;
  readonly out: string;
  readonly maxTurns: number;
  readonly prompt?: string;
  readonly auth: string;
}

export const runCommand = buildCommand({
  async func(this: LocalContext, flags: RunFlags, reference: string): Promise<void> {
    const models = createModels(flags.auth);
    const model = models.getModel(flags.provider, flags.model);
    if (!model) {
      const providers = models.getProviders().map((p) => p.id);
      if (!providers.includes(flags.provider)) {
        throw new Error(
          `unknown provider ${flags.provider}. Known providers: ${providers.join(", ")}`
        );
      }
      const ids = models.getModels(flags.provider).map((m) => m.id);
      throw new Error(
        `unknown model ${flags.model} for provider ${flags.provider}. Known models: ${ids.join(", ")}`
      );
    }
    if (!model.input.includes("image")) {
      throw new Error(`model ${model.id} does not accept image input`);
    }
    if (flags.reasoning !== "off") {
      if (!model.reasoning)
        throw new Error(`model ${model.id} does not support reasoning; use --reasoning off`);
      const supported = getSupportedThinkingLevels(model);
      if (!supported.includes(flags.reasoning)) {
        throw new Error(
          `model ${model.id} does not support reasoning level ${flags.reasoning}. Supported: ${supported.join(", ")}`
        );
      }
    }
    const auth = await models.checkAuth(flags.provider);
    if (!auth) {
      throw new Error(
        `provider ${flags.provider} has no credentials. Set its API key env var or run: login ${flags.provider}`
      );
    }

    await checkContainer(flags.container);
    const referencePng = await readFile(reference);
    const systemPrompt = await readFile(
      flags.prompt ?? new URL("../../prompt.md", import.meta.url),
      "utf8"
    );
    const out = new OutputDir(flags.out);
    await out.prepare(referencePng);

    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    log(`auth: ${auth.source ?? auth.type}`);
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
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        { brief: "Path to the reference PNG", parse: String, placeholder: "reference.png" }
      ]
    },
    flags: {
      provider: { kind: "parsed", parse: String, brief: "pi-ai provider id" },
      model: { kind: "parsed", parse: String, brief: "Model id within the provider" },
      reasoning: {
        kind: "enum",
        values: REASONING_LEVELS,
        brief: "Reasoning level"
      },
      container: { kind: "parsed", parse: String, brief: "Name of the running renderer container" },
      out: {
        kind: "parsed",
        parse: String,
        brief: "Output directory for this run"
      },
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
      },
      auth: authFlag
    }
  },
  docs: {
    brief: "Run the benchmark on one reference image."
  }
});
