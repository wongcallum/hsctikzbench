import type { Judgement, SampleSummary } from "../../shared/judge.ts";
import { json, request, requestEmpty } from "../http.ts";

export const fetchSamples = (blind: boolean) =>
  request<SampleSummary[]>(blind ? "/api/samples?blind" : "/api/samples");

export const saveJudgement = (runId: string, judgement: Judgement) =>
  request<Judgement>(`/api/runs/${encodeURIComponent(runId)}/judgement`, json("PUT", judgement));

export const clearJudgement = (runId: string) =>
  requestEmpty(`/api/runs/${encodeURIComponent(runId)}/judgement`, { method: "DELETE" });

export const cropUrl = (stem: string) => `/files/crops/${encodeURIComponent(stem)}.png`;

export const runFileUrl = (runId: string, file: string) =>
  `/runs/${encodeURIComponent(runId)}/${file.split("/").map(encodeURIComponent).join("/")}`;
