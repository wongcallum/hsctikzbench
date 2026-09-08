import type { Category, Role } from "hsctikzbench-cli/manifest";
import type { RunResult, RunStatus } from "hsctikzbench-cli/output";

export type { RunResult, RunStatus };

export type UserRole = "owner" | "judge";

export interface Me {
  login: string;
  role: UserRole;
}

export type JobStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export interface LaunchParams {
  batch: string;
  provider: string;
  model: string;
  reasoning: string;
  maxTurns: number;
  jobs: number;
  resume: boolean;
  renderer: string;
  exams: string[];
  samples: string[];
}

export interface Job {
  id: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: JobStatus;
  exitCode: number | null;
  error: string | null;
  params: LaunchParams;
  command: string[];
  cwd: string;
  outDir: string;
  stems: string[];
  pid: number | null;
}

export type LogStream = "out" | "err" | "sys" | "progress";

export interface LogLine {
  n: number;
  t: number;
  stream: LogStream;
  text: string;
}

export interface SampleProgress {
  turn: number | null;
  maxTurns: number | null;
  cost: number | null;
  lastLine: string | null;
  lastAt: number | null;
  outcome: string | null;
  done: number | null;
}

export interface JobProgress {
  source: "log" | "events";
  done: number;
  total: number;
  samples: Record<string, SampleProgress>;
}

export type SseEvent =
  | { type: "line"; line: LogLine }
  | { type: "status"; job: Job }
  | { type: "progress"; progress: JobProgress };

export type SamplePhase = "pending" | "running" | "done" | "interrupted";

export interface SampleState {
  stem: string;
  exam: string;
  question: string;
  option: string | null;
  role: string;
  category: string;
  hasCrop: boolean;
  phase: SamplePhase;
  result: RunResult | null;
  renders: string[];
  hasSubmission: boolean;
  progress: SampleProgress | null;
}

export interface StatusCounts {
  submitted: number;
  max_turns: number;
  error: number;
  running: number;
  pending: number;
  interrupted: number;
}

export interface BatchSummary {
  name: string;
  jobId: string | null;
  jobStatus: JobStatus | null;
  counts: StatusCounts;
  cost: number;
  model: string | null;
  updatedAt: number;
}

export interface BatchDetail {
  name: string;
  job: Job | null;
  samples: SampleState[];
  counts: StatusCounts;
  cost: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  reasoning: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  auth: string | null;
  models: ModelInfo[];
}

export interface ManifestSample {
  stem: string;
  question: string;
  option: string | null;
  role: Role;
  category: Category;
}

export interface ManifestExam {
  id: string;
  course: string;
  year: number;
  samples: ManifestSample[];
}

export interface Info {
  runsDir: string;
  exams: ManifestExam[];
  providers: ProviderInfo[];
  reasoningLevels: string[];
  renderers: { id: string; available: boolean }[];
  problems: string[];
}

export const BATCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
