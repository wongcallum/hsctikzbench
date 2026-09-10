import { createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  StoredJudgementSchema,
  StoredResolutionSchema,
  type Judgement,
  type JudgementInput,
  type StoredJudgement,
  type StoredResolution
} from "../shared/judge.ts";
import type { Standing, UserRole } from "../shared/types.ts";
import { judgesByBatch, loadAssignments } from "./assignments.ts";
import { config } from "./env.ts";
import { loginKey, type User } from "./users.ts";

export const JUDGEMENTS_DIR = "judgements";
export const RESOLUTION_FILE = "resolution.json";

export interface JudgingContext {
  readonly login: string;
  readonly role: UserRole;
  /** Batches this user votes on. The owner is assigned like any judge. */
  readonly batches: ReadonlySet<string>;
  /** Assigned judges per batch. */
  readonly judges: ReadonlyMap<string, string[]>;
}

export interface RunView {
  /** Always in force for judges; the owner asks for it on the Judge tab. Drops anything
   * naming the model and narrows the listing to the viewer's assigned batches. */
  blind: boolean;
  judging: JudgingContext;
}

export async function judgingContext(user: User): Promise<JudgingContext> {
  const assignments = await loadAssignments();
  return {
    login: user.login,
    role: user.role,
    batches: new Set(assignments[loginKey(user.login)] ?? []),
    judges: judgesByBatch(assignments)
  };
}

export const mayJudge = (judging: JudgingContext, batch: string) => judging.batches.has(batch);

export const maySee = (view: RunView, batch: string) =>
  mayJudge(view.judging, batch) || (!view.blind && view.judging.role === "owner");

export const judgementFile = (runDir: string, login: string) =>
  path.join(runDir, JUDGEMENTS_DIR, `${loginKey(login)}.json`);

export const resolutionFile = (runDir: string) => path.join(runDir, RESOLUTION_FILE);

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function readJudgements(runDir: string): Promise<StoredJudgement[]> {
  let names: string[];
  try {
    names = await readdir(path.join(runDir, JUDGEMENTS_DIR));
  } catch {
    return [];
  }
  const judgements = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map(async (name): Promise<StoredJudgement | null> => {
        const parsed = StoredJudgementSchema.safeParse(
          await readJson(path.join(runDir, JUDGEMENTS_DIR, name))
        );
        // The file name is the judge's identity; the field inside is only a copy of it.
        return parsed.success && loginKey(parsed.data.judge) === name.slice(0, -5)
          ? parsed.data
          : null;
      })
  );
  return judgements.filter((j) => j !== null);
}

export async function readResolution(runDir: string): Promise<StoredResolution | null> {
  const parsed = StoredResolutionSchema.safeParse(await readJson(resolutionFile(runDir)));
  return parsed.success ? parsed.data : null;
}

const stamp = (judgement: JudgementInput) => ({
  ...judgement,
  judgedAt: new Date().toISOString()
});

/** Stamps the vote with the server's clock, so the order of verdicts cannot be spoofed. */
export async function writeJudgement(
  runDir: string,
  login: string,
  judgement: JudgementInput
): Promise<StoredJudgement> {
  const stored: StoredJudgement = { ...stamp(judgement), judge: login };
  await mkdir(path.join(runDir, JUDGEMENTS_DIR), { recursive: true });
  await writeFile(judgementFile(runDir, login), `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

export const removeJudgement = (runDir: string, login: string) =>
  rm(judgementFile(runDir, login), { force: true });

export async function writeResolution(
  runDir: string,
  login: string,
  judgement: JudgementInput
): Promise<StoredResolution> {
  const stored: StoredResolution = { ...stamp(judgement), by: login };
  await mkdir(runDir, { recursive: true });
  await writeFile(resolutionFile(runDir), `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

export const removeResolution = (runDir: string) => rm(resolutionFile(runDir), { force: true });

const own = (judgements: StoredJudgement[], login: string) =>
  judgements.find((j) => loginKey(j.judge) === loginKey(login));

export function ownJudgement(judgements: StoredJudgement[], login: string): Judgement | null {
  const found = own(judgements, login);
  if (!found) return null;
  const { judge: _judge, ...judgement } = found;
  return judgement;
}

/** The owner's own vote is one vote among the judges'; only a resolution settles as owner. */
export function standing(
  judgements: StoredJudgement[],
  resolution: StoredResolution | null,
  required: readonly string[]
): Standing {
  const missing = required.filter((login) => !own(judgements, login));
  const disputed = (cause: Standing["cause"]): Standing => ({
    verdict: "disputed",
    by: null,
    missing,
    cause
  });

  if (resolution) {
    if (resolution.verdict === "needs_review") return disputed("held");
    const reopened = judgements.some(
      (j) => j.verdict !== resolution.verdict && j.judgedAt > resolution.judgedAt
    );
    if (reopened) return disputed("reopened");
    return { verdict: resolution.verdict, by: "owner", missing, cause: null };
  }

  const verdicts = new Set(judgements.map((j) => j.verdict));
  if (verdicts.has("needs_review")) return disputed("needs_review");
  if (verdicts.size > 1) return disputed("split");
  if (judgements.length === 0 || missing.length > 0) {
    return { verdict: "pending", by: null, missing, cause: null };
  }
  return { verdict: [...verdicts][0] as "pass" | "fail", by: "judges", missing: [], cause: null };
}

/** Keyed with a secret so a judge who guesses a batch name cannot confirm it by recomputing
 * the id. */
export const runId = (batch: string, stem: string) =>
  createHmac("sha256", config.runIdSecret).update(`${batch}/${stem}`).digest("hex").slice(0, 12);

/** A per-judge order for blind listings, so two judges cannot compare notes by position. */
export const blindOrder = (login: string, id: string) =>
  createHmac("sha256", loginKey(login)).update(id).digest("hex");
