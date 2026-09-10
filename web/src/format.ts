import type { JobStatus, Run, RunStatus, SamplePhase, SampleInfo } from "../shared/types.ts";

export const money = (n: number) => `$${n.toFixed(n >= 10 ? 2 : 4)}`;

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";

export const relative = (ms: number) => {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
};

export const words = (s: string) => s.replaceAll("_", " ");

export function sampleLabel(sample: Pick<SampleInfo, "question" | "option" | "stem">): string {
  if (!sample.question) return sample.stem;
  return sample.option ? `Q${sample.question} (${sample.option})` : `Q${sample.question}`;
}

export function runLabel(runs: readonly Run[], run: Run): string {
  if (run.source) return run.source.batch;
  return `Run ${runs.findIndex((r) => r.id === run.id) + 1}`;
}

export type Tone = "green" | "orange" | "red" | "blue" | "gray";

export const jobTone: Record<JobStatus, Tone> = {
  running: "blue",
  succeeded: "green",
  failed: "red",
  cancelled: "gray",
  interrupted: "orange"
};

export const runTone: Record<RunStatus, Tone> = {
  submitted: "green",
  max_turns: "orange",
  error: "red"
};

export const phaseTone: Record<SamplePhase, Tone> = {
  pending: "gray",
  running: "blue",
  done: "green",
  interrupted: "orange"
};

export function runStatus(run: Run): { text: string; tone: Tone } {
  if (run.phase === "done" && run.result) {
    return { text: words(run.result.status), tone: runTone[run.result.status] };
  }
  if (run.phase === "running" && run.progress?.turn) {
    return { text: `turn ${run.progress.turn}/${run.progress.maxTurns}`, tone: "blue" };
  }
  return { text: run.phase, tone: phaseTone[run.phase] };
}
