import { Badge } from "@radix-ui/themes";
import type { Run, SampleSummary } from "../shared/types.ts";
import { runStatus } from "./format.ts";
import { judgingCounts, judgingState, resolvedState } from "./sample.ts";

const JUDGING = {
  running: { color: "blue", label: "awaiting result" },
  unjudgeable: { color: "gray", label: "no reference" },
  unjudged: { color: "gray", label: "unjudged" },
  pending: { color: "gray", label: "pending" },
  needs_review: { color: "orange", label: "needs review" },
  disputed: { color: "purple", label: "disputed" },
  pass: { color: "green", label: "pass" },
  fail: { color: "red", label: "fail" }
} as const;

export function StatusBadge({ run }: { run: Run }) {
  const status = runStatus(run);
  return (
    <Badge color={status.tone} variant="soft" size="1">
      {status.text}
    </Badge>
  );
}

interface Props {
  sample: SampleSummary;
  /** Show the viewer's own judging rather than the settled state. */
  own: boolean;
}

export function RunBadges({ sample, run, own }: Props & { run: Run }) {
  const state = own ? judgingState(sample, run) : resolvedState(sample, run);
  const judging = JUDGING[state];
  const outline = state === "unjudged" || state === "pending";
  return (
    <>
      <StatusBadge run={run} />
      <Badge color={judging.color} variant={outline ? "outline" : "soft"} size="1">
        {judging.label}
      </Badge>
    </>
  );
}

export function SampleBadges({ sample, own }: Props) {
  const runs = sample.runs;
  if (runs.length === 0) return null;
  if (runs.length === 1) return <RunBadges sample={sample} run={runs[0]!} own={own} />;
  const counts = judgingCounts(
    runs.map((run) => ({ sample, run })),
    own
  );
  return (
    <>
      <Badge color={counts.pending > 0 ? "orange" : "green"} variant="soft" size="1">
        {counts.resolved}/{counts.total} judged
      </Badge>
      {counts.disputed > 0 && (
        <Badge color="purple" variant="soft" size="1">
          {counts.disputed} disputed
        </Badge>
      )}
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
