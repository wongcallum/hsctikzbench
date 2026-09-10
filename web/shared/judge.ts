import * as z from "zod";

export const RUBRIC_VERSION = 1;

const Fields = z.strictObject({
  rubricVersion: z.literal(RUBRIC_VERSION),
  verdict: z.enum(["pass", "fail", "needs_review"]),
  reason: z.string().trim()
});

const needsReason = {
  check: (value: { verdict: string; reason: string }) =>
    value.verdict !== "fail" || value.reason.length > 0,
  params: { path: ["reason"], message: "a failure needs a concrete reason" }
};

/** What a judge submits: their verdict on one run. The server stamps the time. */
export const JudgementInputSchema = Fields.refine(needsReason.check, needsReason.params);

const Stamped = Fields.extend({ judgedAt: z.iso.datetime() });

/** A verdict as the judge who gave it sees it back. */
export const JudgementSchema = Stamped.refine(needsReason.check, needsReason.params);

/** What is written to `judgements/<login>.json`: a judge's vote, and who gave it. */
export const StoredJudgementSchema = Stamped.extend({ judge: z.string().min(1) }).refine(
  needsReason.check,
  needsReason.params
);

/**
 * What is written to a run's `resolution.json`: the owner's settling verdict, given in Resolve
 * with every vote in view, and which owner gave it. Kept apart from the owner's own vote, which
 * is one file among the judges' like any other.
 */
export const StoredResolutionSchema = Stamped.extend({ by: z.string().min(1) }).refine(
  needsReason.check,
  needsReason.params
);

export type JudgementInput = z.infer<typeof JudgementInputSchema>;
export type Judgement = z.infer<typeof JudgementSchema>;
export type StoredJudgement = z.infer<typeof StoredJudgementSchema>;
export type StoredResolution = z.infer<typeof StoredResolutionSchema>;
export type Verdict = Judgement["verdict"];
