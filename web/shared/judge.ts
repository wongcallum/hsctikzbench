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
