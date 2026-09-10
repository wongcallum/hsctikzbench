import type { Category, Role } from "hsctikzbench-cli/manifest";
import type { RunResult, RunStatus } from "hsctikzbench-cli/output";
import type { Judgement, StoredJudgement, StoredResolution } from "./judge.ts";

export type { RunResult, RunStatus };

export type UserRole = "owner" | "judge";

/** How the server signs people in: GitHub OAuth, or everyone as the single local owner. */
export type AuthMode = "github" | "single";

export interface Me {
  login: string;
  role: UserRole;
}

/** Which batches each login judges. The owner judges by assignment like anyone else. */
export type Assignments = Record<string, string[]>;

export interface JudgeProgress {
  judged: number;
  total: number;
}

export interface AssignmentsView {
  assignments: Assignments;
  users: Record<string, UserRole>;
  batches: string[];
  /** Per judge, per assigned batch: judgeable runs and how many they have judged. */
  progress: Record<string, Record<string, JudgeProgress>>;
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

export type RunOutcome = Pick<
  RunResult,
  "status" | "error" | "turns" | "renders" | "successfulRenders"
>;

export type RunModel = Pick<
  RunResult,
  "provider" | "model" | "reasoning" | "usage" | "durationMs" | "startedAt" | "harness"
>;

/** Where a run came from. Absent from blind listings. */
export interface RunSource {
  batch: string;
  model: RunModel | null;
}

export type ResolvedVerdict = "pass" | "fail" | "disputed" | "pending";

/** held: the owner asked to look again. reopened: a judge voted against the resolution. */
export type DisputeCause = "split" | "needs_review" | "held" | "reopened";

export interface Standing {
  verdict: ResolvedVerdict;
  /** What settled it: the owner's resolution, or the judges' unanimous votes. */
  by: "owner" | "judges" | null;
  /** Assigned judges who have not voted. */
  missing: string[];
  cause: DisputeCause | null;
}

export interface Run {
  id: string;
  phase: SamplePhase;
  result: RunOutcome | null;
  hasSubmission: boolean;
  /** Render file names under `renders/`, in order. */
  renders: string[];
  /** The requesting user's own vote. */
  judgement: Judgement | null;
  /** Every judge's vote. Owner only, and never in a blind listing. */
  judgements: StoredJudgement[] | null;
  /** The owner's settling verdict, if given. Owner only, and never in a blind listing. */
  resolution: StoredResolution | null;
  /** Where the run stands across the votes. Owner only, and never in a blind listing. */
  standing: Standing | null;
  source: RunSource | null;
  /** Live progress while the job runs. Absent from blind listings. */
  progress: SampleProgress | null;
}

export const hasSubmission = (run: Run) => run.result?.status === "submitted" && run.hasSubmission;

/** Fields are blank for a stem the manifest does not know. */
export interface SampleInfo {
  stem: string;
  exam: string;
  question: string;
  option: string | null;
  role: string;
  category: string;
  hasCrop: boolean;
}

export interface SampleSummary extends SampleInfo {
  runs: Run[];
}

export interface BatchSample extends SampleInfo {
  run: Run;
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
  samples: BatchSample[];
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
