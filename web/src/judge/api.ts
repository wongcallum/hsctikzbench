import type { Judgement, SampleSummary } from "../../shared/judge.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const fetchSamples = (blind: boolean) =>
  request<SampleSummary[]>(blind ? "/api/samples?blind" : "/api/samples");

export const saveJudgement = (runId: string, judgement: Judgement) =>
  request<Judgement>(`/api/runs/${encodeURIComponent(runId)}/judgement`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(judgement)
  });

export const cropUrl = (stem: string) => `/files/crops/${encodeURIComponent(stem)}.png`;

export const runFileUrl = (runId: string, file: string) =>
  `/runs/${encodeURIComponent(runId)}/${file.split("/").map(encodeURIComponent).join("/")}`;
