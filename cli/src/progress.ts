import { createWriteStream } from "node:fs";
import type { RunStatus } from "./output.ts";

export type SampleOutcome = RunStatus | "skipped" | "failed";

export type ProgressEvent =
  | { type: "start"; stems: string[]; maxTurns: number }
  | { type: "turn"; stem: string; turn: number; maxTurns: number; cost: number; note: string }
  | {
      type: "done";
      stem: string;
      outcome: SampleOutcome;
      done: number;
      total: number;
      turns: number | null;
      cost: number | null;
      message: string | null;
    };

export type ProgressSink = (event: ProgressEvent) => void;

export function openProgress(fd: number | undefined): ProgressSink {
  if (fd === undefined) return () => {};
  if (!Number.isInteger(fd) || fd < 0) throw new Error("--progress-fd must be a descriptor number");
  const stream = createWriteStream("", { fd });
  // A supervisor that went away must not take the bench down with it.
  stream.on("error", () => {});
  return (event) => {
    stream.write(`${JSON.stringify(event)}\n`);
  };
}
