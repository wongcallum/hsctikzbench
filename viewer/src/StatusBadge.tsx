import { Badge } from "@radix-ui/themes";
import type { RunSummary } from "./types.ts";

const STYLES = {
  submitted: { color: "green", label: "submitted" },
  max_turns: { color: "orange", label: "max turns" },
  error: { color: "red", label: "error" },
  running: { color: "blue", label: "running" }
} as const;

export function StatusBadge({ run }: { run: RunSummary }) {
  const { color, label } = STYLES[run.result?.status ?? "running"];
  return (
    <Badge color={color} variant="soft" size="1">
      {label}
    </Badge>
  );
}
