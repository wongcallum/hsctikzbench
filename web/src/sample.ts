import type { Mode, Run, SampleSummary } from "./types.ts";

export function label(sample: SampleSummary): string {
  const kind = sample.option === null ? "figure" : `option ${sample.option}`;
  return `Q${sample.question} ${kind}`;
}

/** How a run is named in the selector: its batch on the view page, a position when blind. */
export function runLabel(run: Run, index: number, mode: Mode): string {
  return mode === "view" && run.source ? run.source.batch : `Run ${index + 1}`;
}

export type JudgingState =
  | "running"
  | "unjudgeable"
  | "unjudged"
  | "needs_review"
  | "pass"
  | "fail";

export const hasSubmission = (run: Run) => run.result?.status === "submitted" && run.hasSubmission;

/** Whether the run has both a submitted image and a reference crop to judge it against. */
export const isJudgeable = (sample: SampleSummary, run: Run) =>
  hasSubmission(run) && sample.hasCrop;

export function judgingState(sample: SampleSummary, run: Run): JudgingState {
  if (!run.result) return "running";
  if (!hasSubmission(run)) return "fail";
  if (!sample.hasCrop) return "unjudgeable";
  return run.judgement?.verdict ?? "unjudged";
}

export function isPending(sample: SampleSummary, run: Run): boolean {
  const state = judgingState(sample, run);
  return state === "unjudged" || state === "needs_review";
}

/** Whether any of the sample's runs is still waiting on a verdict. */
export const hasPending = (sample: SampleSummary): boolean =>
  sample.runs.some((run) => isPending(sample, run));

/**
 * Samples the sidebar lists: judging drops the ones with nothing left to judge, but keeps the
 * selected sample so it never vanishes from under the judge mid-sample.
 */
export const listedSamples = (
  samples: SampleSummary[],
  mode: Mode,
  selected: string | null
): SampleSummary[] =>
  mode === "view" ? samples : samples.filter((s) => hasPending(s) || s.stem === selected);

export interface SampleRun {
  sample: SampleSummary;
  run: Run;
}

/** Every run in listing order: samples in manifest order, each sample's runs in listed order. */
export const sampleRuns = (samples: SampleSummary[]): SampleRun[] =>
  samples.flatMap((sample) => sample.runs.map((run) => ({ sample, run })));

export function scoreSummary(pairs: SampleRun[]): string {
  const states = pairs
    .map(({ sample, run }) => judgingState(sample, run))
    .filter((state) => state !== "running");
  const resolved = states.filter((state) => state === "pass" || state === "fail").length;
  const passed = states.filter((state) => state === "pass").length;
  const progress = `${resolved}/${states.length} resolved · ${passed} pass`;
  if (states.length === 0 || resolved !== states.length) return `${progress} · score pending`;
  return `${progress} · faithful reproduction ${((passed / states.length) * 100).toFixed(1)}%`;
}

export interface ScoreLine {
  /** Batch the line covers, or null for a line over every run. */
  batch: string | null;
  summary: string;
}

/** One score line per batch on the view page; a single line over all runs when blind. */
export function scoreLines(samples: SampleSummary[], mode: Mode): ScoreLine[] {
  const pairs = sampleRuns(samples);
  if (pairs.length === 0) return [{ batch: null, summary: "no runs" }];
  if (mode === "judge") return [{ batch: null, summary: scoreSummary(pairs) }];
  const batches = [...new Set(pairs.map(({ run }) => run.source?.batch ?? ""))].sort();
  return batches.map((batch) => ({
    batch,
    summary: scoreSummary(pairs.filter(({ run }) => (run.source?.batch ?? "") === batch))
  }));
}
