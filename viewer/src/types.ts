import type { RunResult } from "hsctikzbench-cli/output";

export type { RunResult, RunStatus } from "hsctikzbench-cli/output";

export interface RunSummary {
  name: string;
  result: RunResult | null;
  hasReference: boolean;
  hasSubmission: boolean;
  renders: string[];
}
