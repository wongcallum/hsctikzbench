import type { Judgement } from "../shared/judge.ts";
import type {
  Assignments,
  AssignmentsView,
  BatchDetail,
  BatchSummary,
  Info,
  Job,
  JobProgress,
  LaunchParams,
  Me,
  Run,
  SampleSummary,
  SseEvent
} from "../shared/types.ts";
import { json, request } from "./http.ts";

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Me;
}

export async function signOut(): Promise<void> {
  const res = await fetch("/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export const fetchInfo = () => request<Info>("/api/info");
export const fetchBatches = () => request<BatchSummary[]>("/api/batches");
export const fetchBatch = (name: string) =>
  request<BatchDetail>(`/api/batches/${encodeURIComponent(name)}`);
export const fetchJob = (id: string) =>
  request<{ job: Job; progress: JobProgress }>(`/api/jobs/${encodeURIComponent(id)}`);
export const launchJob = (params: LaunchParams) => request<Job>("/api/jobs", json("POST", params));
export const cancelJob = (id: string) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, json("POST"));

const blinded = (url: string, blind: boolean) => (blind ? `${url}?blind` : url);

export const fetchSamples = (blind: boolean) =>
  request<SampleSummary[]>(blinded("/api/samples", blind));
export const fetchSample = (stem: string) =>
  request<SampleSummary>(`/api/samples/${encodeURIComponent(stem)}`);

// Both answer with the run as the caller may see it, so the page can patch it in.
export const saveJudgement = (runId: string, judgement: Judgement, blind: boolean) =>
  request<Run>(
    blinded(`/api/runs/${encodeURIComponent(runId)}/judgement`, blind),
    json("PUT", judgement)
  );
export const clearJudgement = (runId: string, blind: boolean) =>
  request<Run>(blinded(`/api/runs/${encodeURIComponent(runId)}/judgement`, blind), {
    method: "DELETE"
  });

export const fetchAssignments = () => request<AssignmentsView>("/api/assignments");
export const saveAssignments = (assignments: Assignments) =>
  request<AssignmentsView>("/api/assignments", json("PUT", assignments));

export const cropUrl = (stem: string) => `/files/crops/${encodeURIComponent(stem)}.png`;
export const runFileUrl = (runId: string, file: string) =>
  `/runs/${encodeURIComponent(runId)}/${file.split("/").map(encodeURIComponent).join("/")}`;

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
