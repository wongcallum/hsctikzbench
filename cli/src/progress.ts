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

export interface ProgressSink {
  (event: ProgressEvent): void;
  /** Flushes pending events. The descriptor stays open; the supervisor owns it. */
  close(): Promise<void>;
}

export function openProgress(fd: number | undefined): ProgressSink {
  if (fd === undefined) return Object.assign(() => {}, { close: async () => {} });
  if (!Number.isInteger(fd) || fd < 0) throw new Error("--progress-fd must be a descriptor number");
  // autoClose would close the descriptor on exit, but it belongs to the supervisor that
  // passed it in. Closing it from under the event loop aborts libuv during teardown.
  const stream = createWriteStream("", { fd, autoClose: false });
  // A supervisor that went away must not take the bench down with it.
  stream.on("error", () => {});
  const emit = (event: ProgressEvent) => {
    stream.write(`${JSON.stringify(event)}\n`);
  };
  return Object.assign(emit, {
    close: () => new Promise<void>((resolve) => stream.end(resolve))
  });
}
