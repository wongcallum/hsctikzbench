import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { JudgementSchema, type Judgement } from "../shared/judge.ts";
import {
  hasSubmission,
  type ManifestSample,
  type SampleProgress,
  type SampleSummary
} from "../shared/types.ts";
import { hasCrop, isDir, JUDGEMENT_FILE, listDirs, readRun, runId, sampleInfo } from "./batches.ts";
import { config } from "./env.ts";
import { HttpError } from "./http.ts";
import type { JobManager } from "./jobs.ts";
import { loadManifest, type LoadedManifest } from "./repo.ts";

export interface RunLocation {
  readonly id: string;
  readonly batch: string;
  readonly stem: string;
  readonly dir: string;
}

interface RunIndex {
  readonly manifest: LoadedManifest;
  readonly batches: string[];
  readonly locations: Map<string, RunLocation>;
}

let runIndex: RunIndex | null = null;

async function refreshRunIndex(): Promise<RunIndex> {
  const [manifest, batches] = await Promise.all([loadManifest(), listDirs(config.runsDir)]);
  const locations = new Map<string, RunLocation>();
  for (const batch of batches) {
    for (const stem of manifest.stems.keys()) {
      const id = runId(batch, stem);
      locations.set(id, { id, batch, stem, dir: path.join(config.runsDir, batch, stem) });
    }
  }
  return (runIndex = { manifest, batches, locations });
}

export async function locateRun(id: string): Promise<RunLocation> {
  let location = (runIndex ?? (await refreshRunIndex())).locations.get(id);
  if (!location) location = (await refreshRunIndex()).locations.get(id);
  if (!location || !(await isDir(location.dir))) throw new HttpError(404, `no run ${id}`);
  return location;
}

/** What each batch on disk holds, so summarising a sample costs no directory probes. */
interface BatchState {
  name: string;
  stems: Set<string>;
  running: boolean;
  progress: Record<string, SampleProgress> | undefined;
}

async function batchStates(batches: string[], jobs: JobManager): Promise<BatchState[]> {
  return Promise.all(
    batches.map(async (name) => {
      const dir = path.join(config.runsDir, name);
      const job = jobs.forOutDir(dir);
      return {
        name,
        stems: new Set(await listDirs(dir)),
        running: job?.status === "running",
        progress: job ? jobs.progress(job.id)?.samples : undefined
      };
    })
  );
}

async function summarize(
  exam: string,
  sample: ManifestSample,
  batches: BatchState[],
  blind: boolean
): Promise<SampleSummary> {
  const [info, runs] = await Promise.all([
    sampleInfo(sample.stem, exam, sample),
    Promise.all(
      batches
        .filter((batch) => batch.stems.has(sample.stem))
        .map((batch) =>
          readRun(batch.name, sample.stem, {
            exists: true,
            running: batch.running,
            progress: batch.progress?.[sample.stem] ?? null,
            blind
          })
        )
    )
  ]);
  // Batches are sorted by name; a blind listing orders by id so the position says nothing.
  if (blind) runs.sort((a, b) => a.id.localeCompare(b.id));
  return { ...info, runs };
}

export async function listSamples(jobs: JobManager, blind: boolean): Promise<SampleSummary[]> {
  const { manifest, batches } = await refreshRunIndex();
  const states = await batchStates(batches, jobs);
  return Promise.all(
    manifest.exams.flatMap((exam) =>
      exam.samples.map((sample) => summarize(exam.id, sample, states, blind))
    )
  );
}

export async function getSample(
  stem: string,
  jobs: JobManager,
  blind: boolean
): Promise<SampleSummary> {
  const { manifest, batches } = await refreshRunIndex();
  const exam = manifest.exams.find((e) => e.id === manifest.stems.get(stem));
  const sample = exam?.samples.find((s) => s.stem === stem);
  if (!exam || !sample) throw new HttpError(404, `no sample ${stem}`);
  return summarize(exam.id, sample, await batchStates(batches, jobs), blind);
}

export async function saveJudgement(id: string, body: unknown): Promise<Judgement> {
  const parsed = JudgementSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `judgement: ${parsed.error.issues[0]!.message}`);
  const location = await locateRun(id);
  const run = await readRun(location.batch, location.stem, {
    exists: true,
    running: false,
    progress: null,
    blind: true
  });
  if (!run.result) throw new HttpError(409, "run has not finished");
  if (!hasSubmission(run)) throw new HttpError(409, "no submission; already counted as a failure");
  if (!(await hasCrop(location.stem))) {
    throw new HttpError(409, "a reference crop is required to judge this submission");
  }
  await writeFile(
    path.join(location.dir, JUDGEMENT_FILE),
    `${JSON.stringify(parsed.data, null, 2)}\n`
  );
  return parsed.data;
}

// Deliberately skips the checks saving makes: a judgement left on a run that is no longer
// judgeable is exactly the one worth clearing.
export async function clearJudgement(id: string): Promise<void> {
  const location = await locateRun(id);
  await rm(path.join(location.dir, JUDGEMENT_FILE), { force: true });
}
