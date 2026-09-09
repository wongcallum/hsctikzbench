import * as z from "zod";

export const RUBRIC_VERSION = 1;

const Fields = z.strictObject({
  rubricVersion: z.literal(RUBRIC_VERSION),
  verdict: z.enum(["pass", "fail", "needs_review"]),
  reason: z.string().trim(),
  judgedAt: z.iso.datetime()
});

const needsReason = {
  check: (value: { verdict: string; reason: string }) =>
    value.verdict !== "fail" || value.reason.length > 0,
  params: { path: ["reason"], message: "a failure needs a concrete reason" }
};

/** What a judge submits: their verdict on one run. */
export const JudgementSchema = Fields.refine(needsReason.check, needsReason.params);

/** What is written to `judgements/<login>.json`: the verdict plus who gave it. */
export const StoredJudgementSchema = Fields.extend({ judge: z.string().min(1) }).refine(
  needsReason.check,
  needsReason.params
);

export type Judgement = z.infer<typeof JudgementSchema>;
export type StoredJudgement = z.infer<typeof StoredJudgementSchema>;
export type Verdict = Judgement["verdict"];
