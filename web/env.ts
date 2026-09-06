import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const env = createEnv({
  server: {
    MANIFEST: z.string().min(1).default(local("../dataset/manifest.json")),
    CROPS_DIR: z.string().min(1).default(local("../data/crops")),
    RUNS_DIR: z.string().min(1).default(local("../data/runs"))
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true
});
