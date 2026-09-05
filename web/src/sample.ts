import type { Judgement, JudgementItem, Run, SampleSummary } from "./types.ts";

export function label(sample: SampleSummary): string {
  const kind = sample.option === null ? "figure" : `option ${sample.option}`;
  return `Q${sample.question} ${kind}`;
}

export const isApproved = (sample: SampleSummary) => sample.checklist !== null;

export const toText = (items: string[] | null) => items?.join("\n") ?? "";

export function fromText(text: string): string[] | null {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return items.length === 0 ? null : items;
}

export type JudgingState =
  | "unjudgeable" // submitted but no checklist to judge against
  | "unjudged"
  | "partial"
  | "pass"
  | "fail";

export const hasSubmission = (run: Run) => run.result?.status === "submitted" && run.hasSubmission;

export function mergeItems(checklist: string[], saved: Judgement | null): JudgementItem[] {
  const answers = new Map(saved?.items?.map((i) => [i.item, i.pass]) ?? []);
  return checklist.map((item) => ({ item, pass: answers.get(item) ?? null }));
}

/** Judging state of the sample's run, or null when it has no run. */
export function judgingState(sample: SampleSummary): JudgingState | null {
  const run = sample.run;
  if (!run) return null;
  if (!hasSubmission(run)) return run.judgement ? "fail" : "unjudged";
  if (sample.checklist === null) return "unjudgeable";
  const items = mergeItems(sample.checklist, run.judgement);
  if (items.every((i) => i.pass === null)) return "unjudged";
  if (items.some((i) => i.pass === null)) return "partial";
  return items.every((i) => i.pass) ? "pass" : "fail";
}

export function needsJudging(sample: SampleSummary): boolean {
  const state = judgingState(sample);
  return state === "unjudged" || state === "partial";
}

/** Whether the sample still needs a checklist or a judgement. */
export const isPending = (sample: SampleSummary) => !isApproved(sample) || needsJudging(sample);

export function withItem(items: JudgementItem[], index: number, pass: boolean | null): Judgement {
  return {
    items: items.map((i, n) => (n === index ? { ...i, pass } : i)),
    judgedAt: new Date().toISOString()
  };
}

export const noSubmission = (): Judgement => ({ items: null, judgedAt: new Date().toISOString() });
