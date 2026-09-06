import type { Run, SampleSummary } from "./types.ts";

export function label(sample: SampleSummary): string {
  const kind = sample.option === null ? "figure" : `option ${sample.option}`;
  return `Q${sample.question} ${kind}`;
}

export type JudgingState =
  | "running"
  | "unjudgeable"
  | "unjudged"
  | "needs_review"
  | "pass"
  | "fail";

export const hasSubmission = (run: Run) => run.result?.status === "submitted" && run.hasSubmission;

/** Whether the sample has both a submitted image and a reference crop to judge it against. */
export const isJudgeable = (sample: SampleSummary) =>
  sample.run !== null && hasSubmission(sample.run) && sample.hasCrop;

/** Judging state of the sample's run, or null when it has no run. */
export function judgingState(sample: SampleSummary): JudgingState | null {
  const run = sample.run;
  if (!run) return null;
  if (!run.result) return "running";
  if (!hasSubmission(run)) return "fail";
  if (!sample.hasCrop) return "unjudgeable";
  return run.judgement?.verdict ?? "unjudged";
}

export function isPending(sample: SampleSummary): boolean {
  const state = judgingState(sample);
  return state === "unjudged" || state === "needs_review";
}

export function scoreSummary(samples: SampleSummary[]): string {
  const states = samples.map(judgingState).filter((state) => state !== null && state !== "running");
  const resolved = states.filter((state) => state === "pass" || state === "fail").length;
  const passed = states.filter((state) => state === "pass").length;
  const progress = `${resolved}/${states.length} resolved · ${passed} pass`;
  if (states.length === 0 || resolved !== states.length) return `${progress} · score pending`;
  return `${progress} · faithful reproduction ${((passed / states.length) * 100).toFixed(1)}%`;
}
