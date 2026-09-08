import type { RunResult } from "hsctikzbench-cli/output";
import * as z from "zod";
import type { ManifestSample } from "./types.ts";

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

export type RunOutcome = Pick<
  RunResult,
  "status" | "error" | "turns" | "renders" | "successfulRenders"
>;

export type ModelInfo = Pick<
  RunResult,
  "provider" | "model" | "reasoning" | "usage" | "durationMs" | "startedAt"
>;

export interface RunSource {
  batch: string;
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

export interface SampleSummary extends ManifestSample {
  exam: string;
  hasCrop: boolean;
  runs: Run[];
}

export const hasSubmission = (run: Run) => run.result?.status === "submitted" && run.hasSubmission;
