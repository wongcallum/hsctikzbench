import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";
import { REASONING_LEVELS } from "hsctikzbench-cli/model";

const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const env = createEnv({
  server: {
    MANIFEST: z.string().min(1).default(local("../dataset/manifest.json")),
    CROPS_DIR: z.string().min(1).default(local("../data/crops")),
    RUNS_DIR: z.string().min(1).default(local("../data/runs")),
    PROMPT: z.string().min(1).default(local("./prompt.md")),
    PROVIDER: z.string().min(1).optional(),
    MODEL: z.string().min(1).optional(),
    REASONING: z.enum(REASONING_LEVELS).default("off"),
    AUTH: z.string().min(1).default(local("../cli/auth.json"))
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true
});
