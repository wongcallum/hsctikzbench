import type { Judgement, Listing } from "./types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const sampleUrl = (stem: string, action: string) =>
  `/api/samples/${encodeURIComponent(stem)}/${action}`;

export const fetchListing = () => request<Listing>("/api/samples");

export const saveChecklist = (stem: string, items: string[] | null) =>
  request<string[] | null>(sampleUrl(stem, "checklist"), put(items));

export const draftChecklist = (stem: string) =>
  request<string[]>(sampleUrl(stem, "draft"), { method: "POST" });

export const saveJudgement = (stem: string, judgement: Judgement) =>
  request<Judgement>(sampleUrl(stem, "judgement"), put(judgement));

export const cropUrl = (stem: string) => `/crops/${encodeURIComponent(stem)}.png`;

export const runFileUrl = (stem: string, file: string) =>
  `/runs/${encodeURIComponent(stem)}/${file.split("/").map(encodeURIComponent).join("/")}`;
