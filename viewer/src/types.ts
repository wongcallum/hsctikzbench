export type RunStatus = "submitted" | "max_turns" | "error";

export interface RunResult {
  status: RunStatus;
  error?: string;
  provider: string;
  model: string;
  reasoning: string;
  turns: number;
  renders: number;
  successfulRenders: number;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
  durationMs: number;
  startedAt: string;
}

export interface RunSummary {
  name: string;
  result: RunResult | null;
  hasReference: boolean;
  hasSubmission: boolean;
  renders: string[];
}
