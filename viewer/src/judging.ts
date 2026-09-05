import type { Judgement, JudgementItem, RunSummary } from "./types.ts";

export type JudgingState =
  | "unjudgeable" // submitted but no checklist to judge against
  | "unjudged"
  | "partial"
  | "pass"
  | "fail";

export function hasSubmission(run: RunSummary): boolean {
  return run.result?.status === "submitted" && run.hasSubmission;
}

export function mergeItems(checklist: string[], saved: Judgement | null): JudgementItem[] {
  const answers = new Map(saved?.items?.map((i) => [i.item, i.pass]) ?? []);
  return checklist.map((item) => ({ item, pass: answers.get(item) ?? null }));
}

export function judgingState(run: RunSummary): JudgingState {
  if (!hasSubmission(run)) return run.judgement ? "fail" : "unjudged";
  if (run.checklist === null) return "unjudgeable";
  const items = mergeItems(run.checklist, run.judgement);
  if (items.every((i) => i.pass === null)) return "unjudged";
  if (items.some((i) => i.pass === null)) return "partial";
  return items.every((i) => i.pass) ? "pass" : "fail";
}

export function needsJudging(run: RunSummary): boolean {
  const state = judgingState(run);
  return state === "unjudged" || state === "partial";
}

export function isJudgeable(run: RunSummary): boolean {
  return judgingState(run) !== "unjudgeable";
}

export function withItem(items: JudgementItem[], index: number, pass: boolean | null): Judgement {
  return {
    items: items.map((i, n) => (n === index ? { ...i, pass } : i)),
    judgedAt: new Date().toISOString()
  };
}

export function noSubmission(): Judgement {
  return { items: null, judgedAt: new Date().toISOString() };
}
