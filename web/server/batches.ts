import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { RESULT_FILE, type RunResult, type RunStatus } from "hsctikzbench-cli/output";
import type {
  BatchDetail,
  BatchSample,
  BatchSummary,
  Job,
  ManifestSample,
  Run,
  SampleInfo,
  SamplePhase,
  SampleProgress,
  StatusCounts
} from "../shared/types.ts";
import { config } from "./env.ts";
import type { JobManager } from "./jobs.ts";
import {
  ownJudgement,
  readJudgements,
  readResolution,
  runId,
  standing,
  type JudgingContext,
  type RunView
} from "./judgements.ts";
import type { LoadedManifest } from "./repo.ts";

interface CachedResult {
  mtimeMs: number;
  size: number;
  result: RunResult | null;
}
const resultCache = new Map<string, CachedResult>();

export async function readResult(
  runDir: string
): Promise<{ result: RunResult | null; mtimeMs: number }> {
  const file = path.join(runDir, RESULT_FILE);
  let info;
  try {
    info = await stat(file);
  } catch {
    resultCache.delete(file);
    return { result: null, mtimeMs: 0 };
  }
  const cached = resultCache.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return { result: cached.result, mtimeMs: info.mtimeMs };
  }
  let result: RunResult | null = null;
  try {
    result = JSON.parse(await readFile(file, "utf8")) as RunResult;
  } catch {
    // being written, or corrupt
  }
  resultCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, result });
  return { result, mtimeMs: info.mtimeMs };
}

const emptyCounts = (): StatusCounts => ({
  submitted: 0,
  max_turns: 0,
  error: 0,
  running: 0,
  pending: 0,
  interrupted: 0
});

export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export const isFile = (file: string) =>
  stat(file).then(
    (s) => s.isFile(),
    () => false
  );

export const isDir = (dir: string) =>
  stat(dir).then(
    (s) => s.isDirectory(),
    () => false
  );

const liveWithoutDir = (job: Job | null) => job?.status === "running";

function phaseOf(result: RunResult | null, exists: boolean, jobRunning: boolean): SamplePhase {
  if (result) return "done";
  if (!exists) return "pending";
  return jobRunning ? "running" : "interrupted";
}

function count(counts: StatusCounts, phase: SamplePhase, result: { status: RunStatus } | null) {
  if (phase === "done" && result) counts[result.status]++;
  else if (phase !== "done") counts[phase]++;
}

export type { RunView };

export interface RunContext {
  /** A missing run directory is pending. */
  exists: boolean;
  /** An unfinished run counts as live only while the batch's job runs. */
  running: boolean;
  progress: SampleProgress | null;
  view: RunView;
}

export async function readRun(batch: string, stem: string, ctx: RunContext): Promise<Run> {
  const dir = path.join(config.runsDir, batch, stem);
  const { judging } = ctx.view;
  const blind = ctx.view.blind || judging.role !== "owner";
  const [{ result }, hasSubmission, renders, judgements, resolution] = ctx.exists
    ? await Promise.all([
        readResult(dir),
        isFile(path.join(dir, "submission.png")),
        listRenders(dir),
        readJudgements(dir),
        readResolution(dir)
      ])
    : [{ result: null }, false, [], [], null];
  // Only the owner, and only unblinded, learns what the others said or how a run stands.
  const unblinded = !blind;
  return {
    id: runId(batch, stem),
    phase: phaseOf(result, ctx.exists, ctx.running),
    result: result && {
      status: result.status,
      turns: result.turns,
      renders: result.renders,
      successfulRenders: result.successfulRenders,
      // Error text may name the provider, so a blind listing drops it.
      ...(blind || result.error === undefined ? {} : { error: result.error })
    },
    hasSubmission,
    renders,
    judgement: ownJudgement(judgements, judging.login),
    judgements: unblinded ? judgements : null,
    resolution: unblinded ? resolution : null,
    standing: unblinded ? standing(judgements, resolution, judging.judges.get(batch) ?? []) : null,
    source: blind
      ? null
      : {
          batch,
          model: result && {
            provider: result.provider,
            model: result.model,
            reasoning: result.reasoning,
            usage: result.usage,
            durationMs: result.durationMs,
            startedAt: result.startedAt,
            ...(result.harness === undefined ? {} : { harness: result.harness })
          }
        },
    // Progress lines quote the bench's output, which may name the model.
    progress: blind ? null : ctx.progress
  };
}

export const hasCrop = (stem: string) => isFile(path.join(config.cropsDir, `${stem}.png`));

export async function sampleInfo(
  stem: string,
  exam: string,
  meta: ManifestSample | null
): Promise<SampleInfo> {
  return {
    stem,
    exam,
    question: meta?.question ?? "",
    option: meta?.option ?? null,
    role: meta?.role ?? "",
    category: meta?.category ?? "",
    hasCrop: await hasCrop(stem)
  };
}

export async function listBatches(jobs: JobManager): Promise<BatchSummary[]> {
  const names = await listDirs(config.runsDir);
  const byOutDir = new Map<string, Job>();
  for (const job of jobs.list()) {
    if (!byOutDir.has(job.outDir)) byOutDir.set(job.outDir, job);
  }
  // A running job earns a row before it has written its directory. A finished one does not:
  // its output is whatever is on disk, so a deleted directory must drop out of the listing.
  const dirs = new Set(names.map((n) => path.join(config.runsDir, n)));
  for (const job of byOutDir.values()) {
    if (liveWithoutDir(job) && path.dirname(job.outDir) === config.runsDir) dirs.add(job.outDir);
  }

  const summaries = await Promise.all(
    [...dirs].map(async (dir): Promise<BatchSummary> => {
      const name = path.basename(dir);
      const job = byOutDir.get(dir) ?? null;
      const running = job?.status === "running";
      const counts = emptyCounts();
      let cost = 0;
      let model: string | null = job ? `${job.params.provider}/${job.params.model}` : null;
      let updatedAt = 0;
      try {
        updatedAt = (await stat(dir)).mtimeMs;
      } catch {
        // job without a directory yet
      }
      const stems = new Set(await listDirs(dir));
      for (const stem of job?.stems ?? []) if (!stems.has(stem)) counts.pending++;
      await Promise.all(
        [...stems].map(async (stem) => {
          const { result, mtimeMs } = await readResult(path.join(dir, stem));
          count(counts, phaseOf(result, true, running), result);
          if (result) {
            cost += result.usage.cost;
            model ??= `${result.provider}/${result.model}`;
            updatedAt = Math.max(updatedAt, mtimeMs);
          }
        })
      );
      if (job) updatedAt = Math.max(updatedAt, Date.parse(job.finishedAt ?? job.createdAt));
      return {
        name,
        jobId: job?.id ?? null,
        jobStatus: job?.status ?? null,
        counts,
        cost,
        model,
        updatedAt
      };
    })
  );
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function batchDetail(
  name: string,
  jobs: JobManager,
  manifest: LoadedManifest,
  judging: JudgingContext
): Promise<BatchDetail | null> {
  const dir = path.join(config.runsDir, name);
  const job = jobs.forOutDir(dir) ?? null;
  if (!(await isDir(dir)) && !liveWithoutDir(job)) return null;
  const existing = new Set(await listDirs(dir));
  const running = job?.status === "running";
  const progress = job ? jobs.progress(job.id) : undefined;

  const wanted = new Set([...(job?.stems ?? []), ...existing]);
  const ordered: { stem: string; meta: ManifestSample | null; exam: string }[] = [];
  for (const exam of manifest.exams) {
    for (const sample of exam.samples) {
      if (wanted.has(sample.stem)) {
        ordered.push({ stem: sample.stem, meta: sample, exam: exam.id });
        wanted.delete(sample.stem);
      }
    }
  }
  for (const stem of [...wanted].sort()) ordered.push({ stem, meta: null, exam: "" });

  const counts = emptyCounts();
  let cost = 0;
  const samples = await Promise.all(
    ordered.map(async ({ stem, meta, exam }): Promise<BatchSample> => {
      const [info, run] = await Promise.all([
        sampleInfo(stem, exam, meta),
        readRun(name, stem, {
          exists: existing.has(stem),
          running,
          progress: progress?.samples[stem] ?? null,
          view: { blind: false, judging }
        })
      ]);
      return { ...info, run };
    })
  );
  for (const { run } of samples) {
    count(counts, run.phase, run.result);
    cost += run.source?.model?.usage.cost ?? 0;
  }
  return { name, job, samples, counts, cost };
}

export async function listRenders(runDir: string): Promise<string[]> {
  try {
    const names = await readdir(path.join(runDir, "renders"));
    return names.filter((n) => n.endsWith(".png")).sort();
  } catch {
    return [];
  }
}
