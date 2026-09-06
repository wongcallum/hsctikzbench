import { Badge } from "@radix-ui/themes";
import { judgingState } from "./sample.ts";
import type { SampleSummary } from "./types.ts";

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
