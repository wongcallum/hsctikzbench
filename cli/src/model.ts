import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel
} from "@earendil-works/pi-ai";
import { authFlag, createModels } from "./context.ts";

export const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const satisfies readonly ModelThinkingLevel[];

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export function supportedReasoningLevels(model: Model<Api>): string[] {
  return model.reasoning ? getSupportedThinkingLevels(model) : ["off"];
}

export interface ModelFlags {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: ReasoningLevel;
  readonly auth: string;
}

export const modelFlags = {
  provider: { kind: "parsed", parse: String, brief: "pi-ai provider id" },
  model: { kind: "parsed", parse: String, brief: "Model id within the provider" },
  reasoning: {
    kind: "enum",
    values: REASONING_LEVELS,
    brief: "Reasoning level"
  },
  auth: authFlag
} as const;

export async function resolveModel(flags: ModelFlags) {
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
  return { models, model, authSource: auth.source ?? auth.type };
}
