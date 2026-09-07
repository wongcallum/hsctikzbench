import type { Category, Role } from "hsctikzbench-cli/manifest";
import type { RunResult } from "hsctikzbench-cli/output";
import * as z from "zod";

export const RUBRIC_VERSION = 1;
export const JudgementSchema = z
  .strictObject({
    rubricVersion: z.literal(RUBRIC_VERSION),
    verdict: z.enum(["pass", "fail", "needs_review"]),
    reason: z.string().trim(),
    judgedAt: z.iso.datetime()
  })
  .refine((value) => value.verdict !== "fail" || value.reason.length > 0, {
    path: ["reason"],
    message: "a failure needs a concrete reason"
  });

export type Judgement = z.infer<typeof JudgementSchema>;
export type Verdict = Judgement["verdict"];

export type Mode = "judge" | "view";

export type RunOutcome = Pick<
  RunResult,
  "status" | "error" | "turns" | "renders" | "successfulRenders"
>;

export type ModelInfo = Pick<
  RunResult,
  "provider" | "model" | "reasoning" | "usage" | "durationMs" | "startedAt"
>;

export interface RunSource {
  /** Name of the bench output directory the run belongs to. */
  batch: string;
  /** Model details from the result; null while the run is still in progress. */
  model: ModelInfo | null;
}

export interface Run {
  id: string;
  result: RunOutcome | null;
  hasSubmission: boolean;
  renders: string[];
  judgement: Judgement | null;
  source: RunSource | null;
}

export interface SampleSummary {
  stem: string;
  exam: string;
  question: string;
  option: string | null;
  role: Role;
  category: Category;
  hasCrop: boolean;
  runs: Run[];
}
