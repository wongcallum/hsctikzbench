import { randomBytes } from "node:crypto";
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
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SESSION_SECRET: z.string().min(32).optional(),
    USERS_FILE: z.string().min(1).default(local("../users.json")),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    PUBLIC_URL: z.url().optional(),
    AUTH_DEV_USER: z.string().min(1).optional()
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true
});

const production = env.NODE_ENV === "production";
if (production) {
  if (env.AUTH_DEV_USER !== undefined)
    throw new Error("AUTH_DEV_USER must not be set in production");
  if (env.SESSION_SECRET === undefined) throw new Error("SESSION_SECRET is required in production");
  if (env.GITHUB_CLIENT_ID === undefined || env.GITHUB_CLIENT_SECRET === undefined) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production");
  }
}

const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "");

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
  production,
  benchCommand: env.RUNNER_BENCH_COMMAND,
  usersFile: path.resolve(env.USERS_FILE),
  // Without a configured secret, sessions last only as long as the process.
  sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString("hex"),
  publicUrl,
  secureCookies: publicUrl.startsWith("https:"),
  github:
    env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : null,
  devUser: env.AUTH_DEV_USER ?? null
};

export function repoProblems(): string[] {
  const problems: string[] = [];
  if (!existsSync(path.join(config.cliDir, "node_modules", ".bin", "tsx"))) {
    problems.push(`${config.cliDir} has no node_modules; run pnpm install`);
  }
  if (!existsSync(config.manifest)) problems.push(`no manifest at ${config.manifest}`);
  return problems;
}
