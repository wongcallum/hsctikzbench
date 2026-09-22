import * as z from "zod";

export const CHOICES = ["left", "right", "tie"] as const;
export type Choice = (typeof CHOICES)[number];

const runId = z.string().regex(/^[0-9a-f]{12}$/, "bad run id");

/** The outcome of one pair as the judge saw it: which side, if either, is closer to the
 * reference. The server turns sides back into batches. */
export const OutcomeInputSchema = z.strictObject({
  left: runId,
  right: runId,
  outcome: z.enum(CHOICES)
});

export type OutcomeInput = z.infer<typeof OutcomeInputSchema>;
