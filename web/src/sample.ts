import { hasSubmission, type Run, type SampleSummary } from "../shared/types.ts";
import type { Mode } from "./location.ts";

export type JudgingState =
  | "running"
  | "unjudgeable"
  | "unjudged"
  | "needs_review"
  | "pass"
  | "fail";

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
 * selected sample with a judgeable run so it never vanishes from under the judge mid-sample.
 */
export const listedSamples = (
  samples: SampleSummary[],
  mode: Mode,
  selected: string | null
): SampleSummary[] =>
  mode === "view"
    ? samples
    : samples.filter(
        (s) => hasPending(s) || (s.stem === selected && s.runs.some((run) => isJudgeable(s, run)))
      );

/**
 * Runs the selector lists: judging drops unjudgeable and resolved runs, but keeps the selected
 * judgeable run so it does not vanish from under the judge the moment its verdict is saved.
 */
export const listedRuns = (sample: SampleSummary, mode: Mode, selected: string | null): Run[] =>
  mode === "view"
    ? sample.runs
    : sample.runs.filter(
        (run) => isPending(sample, run) || (run.id === selected && isJudgeable(sample, run))
      );

export interface SampleRun {
  sample: SampleSummary;
  run: Run;
}

export interface JudgingCounts {
  total: number;
  running: number;
  unjudgeable: number;
  pending: number;
  resolved: number;
  passed: number;
}

/** Every run in listing order: samples in manifest order, each sample's runs in listed order. */
export const sampleRuns = (samples: SampleSummary[]): SampleRun[] =>
  samples.flatMap((sample) => sample.runs.map((run) => ({ sample, run })));

export function judgingCounts(pairs: readonly SampleRun[]): JudgingCounts {
  const counts: JudgingCounts = {
    total: pairs.length,
    running: 0,
    unjudgeable: 0,
    pending: 0,
    resolved: 0,
    passed: 0
  };
  for (const { sample, run } of pairs) {
    switch (judgingState(sample, run)) {
      case "running":
        counts.running++;
        break;
      case "unjudgeable":
        counts.unjudgeable++;
        break;
      case "unjudged":
      case "needs_review":
        counts.pending++;
        break;
      case "pass":
        counts.passed++;
        counts.resolved++;
        break;
      case "fail":
        counts.resolved++;
        break;
    }
  }
  return counts;
}

export function scoreSummary(pairs: SampleRun[]): string {
  const { total, running, resolved, passed } = judgingCounts(pairs);
  const considered = total - running;
  const progress = `${resolved}/${considered} resolved · ${passed} pass`;
  if (considered === 0 || resolved !== considered) return `${progress} · score pending`;
  return `${progress} · faithful reproduction ${((passed / considered) * 100).toFixed(1)}%`;
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
