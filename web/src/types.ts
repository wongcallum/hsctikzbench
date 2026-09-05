import type { Category, Role } from "hsctikzbench-cli/manifest";
import type { RunResult } from "hsctikzbench-cli/output";

export type { RunResult, RunStatus } from "hsctikzbench-cli/output";

export interface JudgementItem {
  item: string;
  pass: boolean | null;
}

export interface Judgement {
  items: JudgementItem[] | null;
  judgedAt: string;
}

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
