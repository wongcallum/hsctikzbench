import type { Judgement, RunSummary } from "./types.ts";

export async function fetchRuns(): Promise<RunSummary[]> {
  const res = await fetch("/api/runs");
  if (!res.ok) throw new Error(`listing runs failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RunSummary[];
}

export async function saveJudgement(run: string, judgement: Judgement): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(run)}/judgement`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(judgement)
  });
  if (!res.ok) throw new Error(`saving judgement failed: ${res.status} ${await res.text()}`);
}

export function runFileUrl(run: string, file: string): string {
  return `/runs/${encodeURIComponent(run)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}
