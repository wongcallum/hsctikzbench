import path from "node:path";
import type { ManifestSample, SampleProgress, SampleSummary } from "../shared/types.ts";
import { blindOrder, mayJudge, maySee, runId, type JudgingContext } from "./access.ts";
import { isDir, listDirs, readRun, sampleInfo } from "./batches.ts";
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

/** A run in a batch the viewer may not see is a 404, so an id on its own reveals nothing.
 * With `assignedOnly`, the owner too is held to their assignments. */
export async function locateRun(
  id: string,
  judging: JudgingContext,
  assignedOnly = false
): Promise<RunLocation> {
  let location = (runIndex ?? (await refreshRunIndex())).locations.get(id);
  if (!location) location = (await refreshRunIndex()).locations.get(id);
  const allowed =
    location &&
    (assignedOnly ? mayJudge(judging, location.batch) : maySee(judging, location.batch));
  if (!location || !allowed || !(await isDir(location.dir))) {
    throw new HttpError(404, `no run ${id}`);
  }
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

const visibleBatches = (batches: string[], judging: JudgingContext) =>
  batches.filter((batch) => maySee(judging, batch));

async function summarize(
  exam: string,
  sample: ManifestSample,
  batches: BatchState[],
  judging: JudgingContext
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
            judging
          })
        )
    )
  ]);
  // Batches are sorted by name; a blind listing is ordered per viewer so the position says
  // nothing and two judges cannot line their lists up.
  if (judging.role !== "owner") {
    const key = new Map(runs.map((run) => [run.id, blindOrder(judging.login, run.id)]));
    runs.sort((a, b) => key.get(a.id)!.localeCompare(key.get(b.id)!));
  }
  return { ...info, runs };
}

export async function listSamples(
  jobs: JobManager,
  judging: JudgingContext
): Promise<SampleSummary[]> {
  const { manifest, batches } = await refreshRunIndex();
  const states = await batchStates(visibleBatches(batches, judging), jobs);
  return Promise.all(
    manifest.exams.flatMap((exam) =>
      exam.samples.map((sample) => summarize(exam.id, sample, states, judging))
    )
  );
}

export async function getSample(
  stem: string,
  jobs: JobManager,
  judging: JudgingContext
): Promise<SampleSummary> {
  const { manifest, batches } = await refreshRunIndex();
  const exam = manifest.exams.find((e) => e.id === manifest.stems.get(stem));
  const sample = exam?.samples.find((s) => s.stem === stem);
  if (!exam || !sample) throw new HttpError(404, `no sample ${stem}`);
  const states = await batchStates(visibleBatches(batches, judging), jobs);
  return summarize(exam.id, sample, states, judging);
}
