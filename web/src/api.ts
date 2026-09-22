import type { OutcomeInput } from "../shared/compare.ts";
import type {
  Assignments,
  AssignmentsView,
  AuthMode,
  BatchDetail,
  BatchSummary,
  CompareSample,
  Info,
  Job,
  JobProgress,
  LaunchParams,
  Me,
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

export const fetchAuthMode = async () => (await request<{ mode: AuthMode }>("/api/auth")).mode;

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

export const fetchSamples = () => request<SampleSummary[]>("/api/samples");
export const fetchSample = (stem: string) =>
  request<SampleSummary>(`/api/samples/${encodeURIComponent(stem)}`);

export const fetchCompare = () => request<CompareSample[]>("/api/compare");
export const recordOutcome = (stem: string, outcome: OutcomeInput) =>
  request<CompareSample>(`/api/compare/${encodeURIComponent(stem)}`, json("POST", outcome));
export const undoOutcome = (stem: string) =>
  request<CompareSample>(`/api/compare/${encodeURIComponent(stem)}/last`, { method: "DELETE" });

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
