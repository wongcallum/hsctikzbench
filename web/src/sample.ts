import { hasSubmission, type Run, type SampleSummary, type UserRole } from "../shared/types.ts";
import type { Mode } from "./location.ts";

/** Where one user's judging of a run stands. */
export type JudgingState =
  | "running"
  | "unjudgeable"
  | "unjudged"
  | "needs_review"
  | "pass"
  | "fail";

/** Where the run stands once every judge's verdict is combined. */
export type ResolvedState = "running" | "unjudgeable" | "pending" | "disputed" | "pass" | "fail";

/** Whether the run has both a submitted image and a reference crop to judge it against. */
export const isJudgeable = (sample: SampleSummary, run: Run) =>
  hasSubmission(run) && sample.hasCrop;

export function judgingState(sample: SampleSummary, run: Run): JudgingState {
  if (!run.result) return "running";
  if (!hasSubmission(run)) return "fail";
  if (!sample.hasCrop) return "unjudgeable";
  return run.judgement?.verdict ?? "unjudged";
}

/**
 * The run's settled state. Only the owner is told how the judges' verdicts combine; for a judge
 * this is their own judgement, which is all they may know.
 */
export function resolvedState(sample: SampleSummary, run: Run): ResolvedState {
  const own = judgingState(sample, run);
  if (own === "running" || own === "unjudgeable") return own;
  if (!hasSubmission(run)) return "fail";
  if (run.resolution) return run.resolution.verdict;
  return own === "pass" || own === "fail" ? own : "pending";
}

export function isPending(sample: SampleSummary, run: Run): boolean {
  const state = judgingState(sample, run);
  return state === "unjudged" || state === "needs_review";
}

export const isDisputed = (sample: SampleSummary, run: Run) =>
  resolvedState(sample, run) === "disputed";

/** Whether any of the sample's runs is still waiting on a verdict. */
export const hasPending = (sample: SampleSummary): boolean =>
  sample.runs.some((run) => isPending(sample, run));

const listable: Record<Exclude<Mode, "view">, (sample: SampleSummary, run: Run) => boolean> = {
  judge: isPending,
  resolve: isDisputed
};

/**
 * Samples the sidebar lists: judging and resolving drop the ones with nothing left to do, but
 * keep the selected sample with a judgeable run so it never vanishes from under the judge.
 */
export const listedSamples = (
  samples: SampleSummary[],
  mode: Mode,
  selected: string | null
): SampleSummary[] =>
  mode === "view"
    ? samples
    : samples.filter(
        (s) =>
          s.runs.some((run) => listable[mode](s, run)) ||
          (s.stem === selected && s.runs.some((run) => isJudgeable(s, run)))
      );

/**
 * Runs the selector lists: judging and resolving drop the ones with nothing to do, but keep
 * the selected judgeable run so it does not vanish the moment its verdict is saved.
 */
export const listedRuns = (sample: SampleSummary, mode: Mode, selected: string | null): Run[] =>
  mode === "view"
    ? sample.runs
    : sample.runs.filter(
        (run) => listable[mode](sample, run) || (run.id === selected && isJudgeable(sample, run))
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
  disputed: number;
  resolved: number;
  passed: number;
}

/** Every run in listing order: samples in manifest order, each sample's runs in listed order. */
export const sampleRuns = (samples: SampleSummary[]): SampleRun[] =>
  samples.flatMap((sample) => sample.runs.map((run) => ({ sample, run })));

/** Counts by settled state, or by the viewer's own judging when `own` is set. */
export function judgingCounts(pairs: readonly SampleRun[], own: boolean): JudgingCounts {
  const counts: JudgingCounts = {
    total: pairs.length,
    running: 0,
    unjudgeable: 0,
    pending: 0,
    disputed: 0,
    resolved: 0,
    passed: 0
  };
  for (const { sample, run } of pairs) {
    switch (own ? judgingState(sample, run) : resolvedState(sample, run)) {
      case "running":
        counts.running++;
        break;
      case "unjudgeable":
        counts.unjudgeable++;
        break;
      case "unjudged":
      case "needs_review":
      case "pending":
        counts.pending++;
        break;
      case "disputed":
        counts.disputed++;
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
  const { total, running, disputed, resolved, passed } = judgingCounts(pairs, false);
  const considered = total - running;
  const parts = [`${resolved}/${considered} resolved`, `${passed} pass`];
  if (disputed > 0) parts.push(`${disputed} disputed`);
  const progress = parts.join(" · ");
  if (considered === 0 || resolved !== considered) return `${progress} · score pending`;
  return `${progress} · faithful reproduction ${((passed / considered) * 100).toFixed(1)}%`;
}

/** A judge's own progress through what is assigned to them. */
export function assignedSummary(pairs: SampleRun[]): string {
  const { total, running, unjudgeable, pending } = judgingCounts(pairs, true);
  const assigned = total - running - unjudgeable;
  return `assigned to you: ${assigned} · ${pending} left`;
}

export interface ScoreLine {
  /** Batch the line covers, or null for a line over every run. */
  batch: string | null;
  summary: string;
}

/**
 * One score line per batch when the listing names batches; a single line over every run when
 * blind. A judge sees only how far through their assignment they are.
 */
export function scoreLines(samples: SampleSummary[], mode: Mode, role: UserRole): ScoreLine[] {
  const pairs = sampleRuns(samples);
  if (pairs.length === 0) return [{ batch: null, summary: "no runs" }];
  if (role !== "owner") return [{ batch: null, summary: assignedSummary(pairs) }];
  if (mode === "judge") return [{ batch: null, summary: scoreSummary(pairs) }];
  const batches = [...new Set(pairs.map(({ run }) => run.source?.batch ?? ""))].sort();
  return batches.map((batch) => ({
    batch,
    summary: scoreSummary(pairs.filter(({ run }) => (run.source?.batch ?? "") === batch))
  }));
}
