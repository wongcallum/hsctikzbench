import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const WEB_DIR = fileURLToPath(new URL("../", import.meta.url));
const ROOT_DIR = fileURLToPath(new URL("../../", import.meta.url));
const CLI_DIR = path.join(ROOT_DIR, "cli");

const dataDir = path.resolve(process.env["DATA_DIR"] || path.join(ROOT_DIR, "data"));
const inData = (...rel: string[]) => path.join(dataDir, ...rel);

export const env = createEnv({
  server: {
    MANIFEST: z
      .string()
      .min(1)
      .default(path.join(ROOT_DIR, "dataset", "manifest.json")),
    CROPS_DIR: z.string().min(1).default(inData("crops")),
    RUNS_DIR: z.string().min(1).default(inData("runs")),
    AUTH_FILE: z.string().min(1).default(inData("auth.json")),
    RUNNER_STATE_DIR: z.string().min(1).default(inData("state")),
    PORT: z.coerce.number().int().positive().default(8787),
    HOST: z.string().min(1).default("127.0.0.1"),
    RUNNER_BENCH_COMMAND: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SESSION_SECRET: z.string().min(32).optional(),
    USERS_FILE: z.string().min(1).default(inData("users.json")),
    ASSIGNMENTS_FILE: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    PUBLIC_URL: z.url().optional()
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true
});

const production = env.NODE_ENV === "production";
if (production) {
  if (env.SESSION_SECRET === undefined) throw new Error("SESSION_SECRET is required in production");
  if (env.GITHUB_CLIENT_ID === undefined || env.GITHUB_CLIENT_SECRET === undefined) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production");
  }
}

const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "");

const github =
  env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined
    ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
    : null;

export const SINGLE_USER_LOGIN = "local";
const singleUser = !production && github === null;

export const config = {
  root: WEB_DIR,
  clientDir: path.join(WEB_DIR, "dist", "client"),
  cliDir: CLI_DIR,
  dataDir,
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
  assignmentsFile: path.resolve(
    env.ASSIGNMENTS_FILE ?? path.join(env.RUNNER_STATE_DIR, "assignments.json")
  ),
  // Keys run ids. Fixed in development so ids survive restarts; production requires the secret.
  runIdSecret: env.SESSION_SECRET ?? "development",
  // Without a configured secret, sessions last only as long as the process.
  sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString("hex"),
  publicUrl,
  secureCookies: publicUrl.startsWith("https:"),
  github,
  singleUser
};

const cliBundle = path.join(CLI_DIR, "dist", "cli.mjs");
export const benchEntry: { command: string[]; cwd: string } = production
  ? { command: [process.execPath, cliBundle], cwd: CLI_DIR }
  : { command: [process.execPath, "--import", "tsx", "src/cli.ts"], cwd: CLI_DIR };

export function repoProblems(): string[] {
  const problems: string[] = [];
  if (config.benchCommand === undefined) {
    if (production && !existsSync(cliBundle)) {
      problems.push(`no CLI bundle at ${cliBundle}; run pnpm build first`);
    }
    if (!production && !existsSync(path.join(CLI_DIR, "node_modules", ".bin", "tsx"))) {
      problems.push(`${CLI_DIR} has no node_modules; run pnpm install`);
    }
  }
  if (!existsSync(config.manifest)) problems.push(`no manifest at ${config.manifest}`);
  return problems;
}
