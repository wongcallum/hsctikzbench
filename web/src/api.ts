import type { Judgement, SampleSummary } from "./types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const fetchSamples = () => request<SampleSummary[]>("/api/samples");

export const saveJudgement = (stem: string, judgement: Judgement) =>
  request<Judgement>(`/api/samples/${encodeURIComponent(stem)}/judgement`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(judgement)
  });

export const cropUrl = (stem: string) => `/crops/${encodeURIComponent(stem)}.png`;

export const runFileUrl = (stem: string, file: string) =>
  `/runs/${encodeURIComponent(stem)}/${file.split("/").map(encodeURIComponent).join("/")}`;
