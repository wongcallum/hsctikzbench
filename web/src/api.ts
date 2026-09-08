import type {
  BatchDetail,
  BatchSummary,
  Info,
  Job,
  JobProgress,
  LaunchParams,
  SseEvent
} from "../shared/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

export const fetchInfo = () => request<Info>("/api/info");
export const fetchBatches = () => request<BatchSummary[]>("/api/batches");
export const fetchBatch = (name: string) =>
  request<BatchDetail>(`/api/batches/${encodeURIComponent(name)}`);
export const fetchJob = (id: string) =>
  request<{ job: Job; progress: JobProgress }>(`/api/jobs/${encodeURIComponent(id)}`);
export const launchJob = (params: LaunchParams) => request<Job>("/api/jobs", json("POST", params));
export const cancelJob = (id: string) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, json("POST"));

export const cropUrl = (stem: string) => `/files/crops/${encodeURIComponent(stem)}.png`;
export const runFileUrl = (batch: string, stem: string, file: string) =>
  `/files/runs/${encodeURIComponent(batch)}/${encodeURIComponent(stem)}/` +
  file.split("/").map(encodeURIComponent).join("/");

export function subscribeJob(
  id: string,
  after: number,
  onEvent: (event: SseEvent) => void,
  onError: () => void
): () => void {
  const source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events?after=${after}`);
  source.onmessage = (message) => {
    const event = JSON.parse(message.data as string) as SseEvent | { type: "ping" };
    if (event.type !== "ping") onEvent(event);
  };
  source.onerror = onError;
  return () => source.close();
}
