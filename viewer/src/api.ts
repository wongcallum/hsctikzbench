import type { RunSummary } from "./types.ts";

export async function fetchRuns(): Promise<RunSummary[]> {
  const res = await fetch("/api/runs");
  if (!res.ok) throw new Error(`listing runs failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RunSummary[];
}

export function runFileUrl(run: string, file: string): string {
  return `/runs/${encodeURIComponent(run)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}
