import { hasSubmission, type SampleSummary } from "../shared/types.ts";

export interface RunCounts {
  total: number;
  running: number;
  submitted: number;
  noReference: number;
}

export function runCounts(sample: SampleSummary): RunCounts {
  const counts: RunCounts = { total: sample.runs.length, running: 0, submitted: 0, noReference: 0 };
  for (const run of sample.runs) {
    if (!run.result) counts.running++;
    else if (!hasSubmission(run)) continue;
    else if (!sample.hasCrop) counts.noReference++;
    else counts.submitted++;
  }
  return counts;
}
