import type { BatchDetail, LaunchParams } from "../shared/types.ts";

export interface RunOptions extends Omit<LaunchParams, "batch"> {
  pick: boolean;
}

const STORAGE_KEY = "hsctikzbench-runner.options";

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

export function loadStoredOptions(): Partial<RunOptions> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const o = parsed as Record<string, unknown>;
  const out: Partial<RunOptions> = {};
  if (typeof o.provider === "string") out.provider = o.provider;
  if (typeof o.model === "string") out.model = o.model;
  if (typeof o.reasoning === "string") out.reasoning = o.reasoning;
  if (typeof o.maxTurns === "number" && Number.isFinite(o.maxTurns)) out.maxTurns = o.maxTurns;
  if (typeof o.jobs === "number" && Number.isFinite(o.jobs)) out.jobs = o.jobs;
  if (typeof o.resume === "boolean") out.resume = o.resume;
  if (typeof o.renderer === "string") out.renderer = o.renderer;
  if (isStringArray(o.exams)) out.exams = o.exams;
  if (isStringArray(o.samples)) out.samples = o.samples;
  if (typeof o.pick === "boolean") out.pick = o.pick;
  return out;
}

export function saveStoredOptions(options: RunOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage may be full or disabled; the form still works without it.
  }
}

export function clearStoredOptions(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

// A batch the runner launched has its exact parameters on the job; one made elsewhere only
// has what its results record, so its samples are picked individually.
export function optionsFromBatch(detail: BatchDetail): Partial<RunOptions> {
  if (detail.job) {
    const { batch: _batch, ...params } = detail.job.params;
    return { ...params, pick: params.samples.length > 0 };
  }
  const model = detail.samples.find((s) => s.run.source?.model)?.run.source?.model;
  const stems = detail.samples.map((s) => s.stem);
  const out: Partial<RunOptions> = { exams: [], pick: true, samples: stems };
  if (!model) return out;
  out.provider = model.provider;
  out.model = model.model;
  out.reasoning = model.reasoning;
  if (model.harness) {
    out.maxTurns = model.harness.maxTurns;
    out.renderer = model.harness.renderer;
  }
  return out;
}
