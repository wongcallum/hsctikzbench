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

export const JudgementInputSchema = Fields.refine(needsReason.check, needsReason.params);

const Stamped = Fields.extend({ judgedAt: z.iso.datetime() });

export const JudgementSchema = Stamped.refine(needsReason.check, needsReason.params);

/** Written to `judgements/<login>.json`. */
export const StoredJudgementSchema = Stamped.extend({ judge: z.string().min(1) }).refine(
  needsReason.check,
  needsReason.params
);

/** Written to a run's `resolution.json`, apart from the owner's own vote, which is one
 * judgements file like any other. */
export const StoredResolutionSchema = Stamped.extend({ by: z.string().min(1) }).refine(
  needsReason.check,
  needsReason.params
);

export type JudgementInput = z.infer<typeof JudgementInputSchema>;
export type Judgement = z.infer<typeof JudgementSchema>;
export type StoredJudgement = z.infer<typeof StoredJudgementSchema>;
export type StoredResolution = z.infer<typeof StoredResolutionSchema>;
export type Verdict = Judgement["verdict"];
