import { createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  StoredJudgementSchema,
  type Judgement,
  type JudgementInput,
  type StoredJudgement
} from "../shared/judge.ts";
import type { Resolution, UserRole } from "../shared/types.ts";
import { judgesByBatch, loadAssignments } from "./assignments.ts";
import { config } from "./env.ts";
import { loadUsers, loginKey, type User } from "./users.ts";

export const JUDGEMENTS_DIR = "judgements";

/** Who is looking at a run, and everything needed to say what they may see of its judging. */
export interface JudgingContext {
  readonly login: string;
  readonly role: UserRole;
  /** Roles by lower-cased login, for telling the owner's judgement from the judges'. */
  readonly roles: ReadonlyMap<string, UserRole>;
  /** Batches this user may judge, or null for every batch (the owner). */
  readonly batches: ReadonlySet<string> | null;
  /** Assigned judges per batch. */
  readonly judges: ReadonlyMap<string, string[]>;
}

export async function judgingContext(user: User): Promise<JudgingContext> {
  const [roles, assignments] = await Promise.all([loadUsers(), loadAssignments()]);
  return {
    login: user.login,
    role: user.role,
    roles,
    batches: user.role === "owner" ? null : new Set(assignments[loginKey(user.login)] ?? []),
    judges: judgesByBatch(assignments)
  };
}

export const mayJudge = (ctx: JudgingContext, batch: string) =>
  ctx.batches === null || ctx.batches.has(batch);

export const judgementFile = (runDir: string, login: string) =>
  path.join(runDir, JUDGEMENTS_DIR, `${loginKey(login)}.json`);

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
        let raw: unknown;
        try {
          raw = JSON.parse(await readFile(path.join(runDir, JUDGEMENTS_DIR, name), "utf8"));
        } catch {
          return null;
        }
        const parsed = StoredJudgementSchema.safeParse(raw);
        // The file name is the judge's identity; the field inside is only a copy of it.
        return parsed.success && loginKey(parsed.data.judge) === name.slice(0, -5)
          ? parsed.data
          : null;
      })
  );
  return judgements.filter((j) => j !== null);
}

/** Stamps the verdict with the server's clock, so the order of verdicts cannot be spoofed. */
export async function writeJudgement(
  runDir: string,
  login: string,
  judgement: JudgementInput,
  blind: boolean
): Promise<StoredJudgement> {
  const stored: StoredJudgement = {
    ...judgement,
    judgedAt: new Date().toISOString(),
    judge: login,
    ...(blind ? { blind: true } : {})
  };
  await mkdir(path.join(runDir, JUDGEMENTS_DIR), { recursive: true });
  await writeFile(judgementFile(runDir, login), `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

export const removeJudgement = (runDir: string, login: string) =>
  rm(judgementFile(runDir, login), { force: true });

const own = (judgements: StoredJudgement[], login: string) =>
  judgements.find((j) => loginKey(j.judge) === loginKey(login));

export function ownJudgement(judgements: StoredJudgement[], login: string): Judgement | null {
  const found = own(judgements, login);
  if (!found) return null;
  const { judge: _judge, blind: _blind, ...judgement } = found;
  return judgement;
}

/**
 * The owner's pass or fail settles a run when no judge disagrees. Against disagreement, a
 * verdict given blind on the Judge tab is only an opinion (contested), and one given in
 * Resolve holds until a judge disagrees after it (reopened); the owner's `needs_review`
 * holds the run. Without an owner verdict the judges must agree: a split, or any
 * `needs_review`, is disputed, and a run is pending until every assigned judge has spoken.
 */
export function resolve(
  judgements: StoredJudgement[],
  required: readonly string[],
  roles: ReadonlyMap<string, UserRole>
): Resolution {
  const isOwner = (j: StoredJudgement) => roles.get(loginKey(j.judge)) === "owner";
  const judges = judgements.filter((j) => !isOwner(j));
  const missing = required.filter((login) => !own(judges, login));
  const disputed = (cause: Resolution["cause"]): Resolution => ({
    verdict: "disputed",
    by: null,
    missing,
    cause
  });

  const owner = judgements.find(isOwner);
  if (owner) {
    if (owner.verdict === "needs_review") return disputed("held");
    const disagreeing = judges.filter((j) => j.verdict !== owner.verdict);
    if (disagreeing.length > 0) {
      if (owner.blind) return disputed("contested");
      if (disagreeing.some((j) => j.judgedAt > owner.judgedAt)) return disputed("reopened");
    }
    return { verdict: owner.verdict, by: "owner", missing: [], cause: null };
  }

  const verdicts = new Set(judges.map((j) => j.verdict));
  if (verdicts.has("needs_review")) return disputed("needs_review");
  if (verdicts.size > 1) return disputed("split");
  if (judges.length === 0 || missing.length > 0) {
    return { verdict: "pending", by: null, missing, cause: null };
  }
  return { verdict: [...verdicts][0] as "pass" | "fail", by: "judges", missing: [], cause: null };
}

/**
 * Run ids are keyed with a secret so a judge who guesses a batch name cannot confirm it by
 * recomputing the id. Without a configured secret the key is fixed, so ids survive restarts
 * in development.
 */
export const runId = (batch: string, stem: string) =>
  createHmac("sha256", config.runIdSecret).update(`${batch}/${stem}`).digest("hex").slice(0, 12);

/** A per-judge order for blind listings, so two judges cannot compare notes by position. */
export const blindOrder = (login: string, id: string) =>
  createHmac("sha256", loginKey(login)).update(id).digest("hex");
