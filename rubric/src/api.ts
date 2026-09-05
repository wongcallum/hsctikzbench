import type { SampleSummary } from "./types.ts";

export async function fetchSamples(): Promise<SampleSummary[]> {
  const res = await fetch("/api/samples");
  if (!res.ok) throw new Error(`listing samples failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as SampleSummary[];
}

export async function saveChecklist(stem: string, items: string[] | null): Promise<void> {
  const res = await fetch(`/api/samples/${encodeURIComponent(stem)}/checklist`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items)
  });
  if (!res.ok) throw new Error(`saving checklist failed: ${res.status} ${await res.text()}`);
}

export async function draftChecklist(stem: string): Promise<string[]> {
  const res = await fetch(`/api/samples/${encodeURIComponent(stem)}/draft`, { method: "POST" });
  if (!res.ok) throw new Error(`drafting failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as string[];
}

export function cropUrl(stem: string): string {
  return `/crops/${encodeURIComponent(stem)}.png`;
}
