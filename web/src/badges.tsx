import { Badge } from "@radix-ui/themes";
import { judgingCounts, judgingState } from "./sample.ts";
import type { Run, SampleSummary } from "./types.ts";

const STATUS = {
  submitted: { color: "green", label: "submitted" },
  max_turns: { color: "orange", label: "max turns" },
  error: { color: "red", label: "error" },
  running: { color: "blue", label: "running" }
} as const;

const JUDGING = {
  running: { color: "blue", label: "awaiting result" },
  unjudgeable: { color: "gray", label: "no reference" },
  unjudged: { color: "gray", label: "unjudged" },
  needs_review: { color: "orange", label: "needs review" },
  pass: { color: "green", label: "pass" },
  fail: { color: "red", label: "fail" }
} as const;

/** Run status and judging badges for one run. */
export function RunBadges({ sample, run }: { sample: SampleSummary; run: Run }) {
  const state = judgingState(sample, run);
  const status = STATUS[run.result?.status ?? "running"];
  const judging = JUDGING[state];
  return (
    <>
      <Badge color={status.color} variant="soft" size="1">
        {status.label}
      </Badge>
      <Badge color={judging.color} variant={state === "unjudged" ? "outline" : "soft"} size="1">
        {judging.label}
      </Badge>
    </>
  );
}

/** Judging progress across a sample's runs, or nothing when it has none. */
export function SampleBadges({ sample }: { sample: SampleSummary }) {
  const runs = sample.runs;
  if (runs.length === 0) return null;
  if (runs.length === 1) return <RunBadges sample={sample} run={runs[0]!} />;
  const counts = judgingCounts(runs.map((run) => ({ sample, run })));
  return (
    <>
      <Badge color={counts.pending > 0 ? "orange" : "green"} variant="soft" size="1">
        {counts.resolved}/{counts.total} judged
      </Badge>
      {counts.running > 0 && (
        <Badge color="blue" variant="soft" size="1">
          {counts.running} running
        </Badge>
      )}
      {counts.unjudgeable > 0 && (
        <Badge color="gray" variant="soft" size="1">
          {counts.unjudgeable} no reference
        </Badge>
      )}
    </>
  );
}
