import { Badge } from "@radix-ui/themes";
import { isApproved, judgingState } from "./sample.ts";
import type { SampleSummary } from "./types.ts";

const STATUS = {
  submitted: { color: "green", label: "submitted" },
  max_turns: { color: "orange", label: "max turns" },
  error: { color: "red", label: "error" },
  running: { color: "blue", label: "running" }
} as const;

const JUDGING = {
  unjudgeable: { color: "gray", label: "no checklist" },
  unjudged: { color: "gray", label: "unjudged" },
  partial: { color: "orange", label: "partial" },
  pass: { color: "green", label: "pass" },
  fail: { color: "red", label: "fail" }
} as const;

export function ChecklistBadge({ sample }: { sample: SampleSummary }) {
  return isApproved(sample) ? (
    <Badge color="green" variant="soft" size="1">
      approved
    </Badge>
  ) : (
    <Badge color="gray" variant="outline" size="1">
      no checklist
    </Badge>
  );
}

/** Run status and judging badges, or nothing when the sample has no run. */
export function RunBadges({ sample }: { sample: SampleSummary }) {
  const state = judgingState(sample);
  if (!sample.run || state === null) return null;
  const status = STATUS[sample.run.result?.status ?? "running"];
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
