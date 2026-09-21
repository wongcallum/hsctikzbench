import { createHmac } from "node:crypto";
import type { UserRole } from "../shared/types.ts";
import { judgesByBatch, loadAssignments } from "./assignments.ts";
import { config } from "./env.ts";
import { loginKey, type User } from "./users.ts";

export interface JudgingContext {
  readonly login: string;
  readonly role: UserRole;
  /** Batches this user compares. The owner is assigned like any judge. */
  readonly batches: ReadonlySet<string>;
  /** Assigned judges per batch. */
  readonly judges: ReadonlyMap<string, string[]>;
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

/** Judges see their assigned batches, blind; the owner sees everything. */
export const maySee = (judging: JudgingContext, batch: string) =>
  mayJudge(judging, batch) || judging.role === "owner";

/** Keyed with a secret so a judge who guesses a batch name cannot confirm it by recomputing
 * the id. */
export const runId = (batch: string, stem: string) =>
  createHmac("sha256", config.runIdSecret).update(`${batch}/${stem}`).digest("hex").slice(0, 12);

/** A per-judge order for blind listings, so two judges cannot compare notes by position. */
export const blindOrder = (login: string, id: string) =>
  createHmac("sha256", loginKey(login)).update(id).digest("hex");
