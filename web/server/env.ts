import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const env = createEnv({
  server: {
    MANIFEST: z.string().min(1).default(local("../../dataset/manifest.json")),
    CROPS_DIR: z.string().min(1).default(local("../../data/crops")),
    RUNS_DIR: z.string().min(1).default(local("../../data/runs")),
    AUTH_FILE: z.string().min(1).default(local("../../cli/auth.json")),
    RUNNER_STATE_DIR: z.string().min(1).default(local("../state")),
    PORT: z.coerce.number().int().positive().default(8787),
    HOST: z.string().min(1).default("127.0.0.1"),
    RUNNER_BENCH_COMMAND: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development")
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true
});

export const config = {
  root: local("../"),
  cliDir: local("../../cli"),
  manifest: path.resolve(env.MANIFEST),
  cropsDir: path.resolve(env.CROPS_DIR),
  runsDir: path.resolve(env.RUNS_DIR),
  authFile: path.resolve(env.AUTH_FILE),
  stateDir: path.resolve(env.RUNNER_STATE_DIR),
  port: env.PORT,
  host: env.HOST,
  production: env.NODE_ENV === "production",
  benchCommand: env.RUNNER_BENCH_COMMAND
};

export function repoProblems(): string[] {
  const problems: string[] = [];
  if (!existsSync(path.join(config.cliDir, "node_modules", ".bin", "tsx"))) {
    problems.push(`${config.cliDir} has no node_modules; run pnpm install`);
  }
  if (!existsSync(config.manifest)) problems.push(`no manifest at ${config.manifest}`);
  return problems;
}
