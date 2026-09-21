import { Badge } from "@radix-ui/themes";
import type { CompareSample, Run, SampleSummary } from "../shared/types.ts";
import { runStatus } from "./format.ts";
import { runCounts } from "./sample.ts";

export function StatusBadge({ run }: { run: Run }) {
  const status = runStatus(run);
  return (
    <Badge color={status.tone} variant="soft" size="1">
      {status.text}
    </Badge>
  );
}

export function RunBadges({ sample, run }: { sample: SampleSummary; run: Run }) {
  return (
    <>
      <StatusBadge run={run} />
      {!sample.hasCrop && (
        <Badge color="gray" variant="soft" size="1">
          no reference
        </Badge>
      )}
    </>
  );
}

export function SampleBadges({ sample }: { sample: SampleSummary }) {
  const runs = sample.runs;
  if (runs.length === 0) return null;
  if (runs.length === 1) return <RunBadges sample={sample} run={runs[0]!} />;
  const counts = runCounts(sample);
  return (
    <>
      <Badge color="gray" variant="soft" size="1">
        {counts.submitted}/{counts.total} submitted
      </Badge>
      {counts.running > 0 && (
        <Badge color="blue" variant="soft" size="1">
          {counts.running} running
        </Badge>
      )}
      {counts.noReference > 0 && (
        <Badge color="gray" variant="soft" size="1">
          no reference
        </Badge>
      )}
    </>
  );
}

export function CompareBadges({ sample }: { sample: CompareSample }) {
  if (sample.total === 0) return null;
  const done = sample.done === sample.total;
  return (
    <Badge color={done ? "green" : "orange"} variant="soft" size="1">
      {sample.done}/{sample.total} pairs
    </Badge>
  );
}
