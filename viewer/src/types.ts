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

export interface RunSummary {
  name: string;
  result: RunResult | null;
  hasReference: boolean;
  hasSubmission: boolean;
  renders: string[];
  knownSample: boolean;
  checklist: string[] | null;
  judgement: Judgement | null;
}
