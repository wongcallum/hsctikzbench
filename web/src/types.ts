import type { Category, Role } from "hsctikzbench-cli/manifest";
import type { RunResult } from "hsctikzbench-cli/output";
import * as z from "zod";

export type { RunResult, RunStatus } from "hsctikzbench-cli/output";

export const JudgementItemSchema = z.strictObject({
  item: z.string().trim().min(1),
  pass: z.boolean().nullable()
});

export const JudgementSchema = z.strictObject({
  items: z
    .array(JudgementItemSchema)
    .refine(
      (items) => new Set(items.map(({ item }) => item)).size === items.length,
      "items must be unique"
    )
    .nullable(),
  judgedAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "expected an ISO timestamp")
});

export type JudgementItem = z.infer<typeof JudgementItemSchema>;
export type Judgement = z.infer<typeof JudgementSchema>;

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
  checklist: string[] | null;
  hasCrop: boolean;
  run: Run | null;
}

export interface Listing {
  canDraft: boolean;
  samples: SampleSummary[];
}
