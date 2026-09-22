import { hasSubmission, type SampleSummary } from "../shared/types.ts";

export interface RunCounts {
  total: number;
  running: number;
  submitted: number;
  noReference: boolean;
}

export function runCounts(sample: SampleSummary): RunCounts {
  const counts: RunCounts = {
    total: sample.runs.length,
    running: 0,
    submitted: 0,
    noReference: !sample.hasCrop
  };
  for (const run of sample.runs) {
    if (!run.result) counts.running++;
    else if (hasSubmission(run)) counts.submitted++;
  }
  return counts;
}
