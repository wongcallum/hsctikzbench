import type { Category, Role } from "hsctikzbench-cli/manifest";
import type { RunResult } from "hsctikzbench-cli/output";
import * as z from "zod";

export type { RunResult, RunStatus } from "hsctikzbench-cli/output";

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

export interface Run {
  result: RunResult | null;
  hasSubmission: boolean;
  renders: string[];
  judgement: Judgement | null;
}

export interface SampleSummary {
  stem: string;
  exam: string;
  question: string;
  option: string | null;
  role: Role;
  category: Category;
  hasCrop: boolean;
  run: Run | null;
}
