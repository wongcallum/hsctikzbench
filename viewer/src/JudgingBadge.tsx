import { Badge } from "@radix-ui/themes";
import type { JudgingState } from "./judging.ts";

const STYLES = {
  unjudgeable: { color: "gray", label: "no checklist" },
  unjudged: { color: "gray", label: "unjudged" },
  partial: { color: "orange", label: "partial" },
  pass: { color: "green", label: "pass" },
  fail: { color: "red", label: "fail" }
} as const;

export function JudgingBadge({ state }: { state: JudgingState }) {
  const { color, label } = STYLES[state];
  return (
    <Badge color={color} variant={state === "unjudged" ? "outline" : "soft"} size="1">
      {label}
    </Badge>
  );
}
