import path from "node:path";
import { JudgementSchema } from "../shared/judge.ts";
import {
  hasSubmission,
  type AssignmentsView,
  type JudgeProgress,
  type ManifestSample,
  type Run,
  type SampleProgress,
  type SampleSummary
} from "../shared/types.ts";
import { loadAssignments } from "./assignments.ts";
import {
  hasCrop,
  isDir,
  isFile,
  listDirs,
  readResult,
  readRun,
  sampleInfo,
  type RunView
} from "./batches.ts";
import { config } from "./env.ts";
import { HttpError } from "./http.ts";
import type { JobManager } from "./jobs.ts";
import {
  blindOrder,
  judgementFile,
  mayJudge,
  removeJudgement,
  runId,
  writeJudgement,
  type JudgingContext
} from "./judgements.ts";
import { loadManifest, type LoadedManifest } from "./repo.ts";
import { loadUsers } from "./users.ts";

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

/** Finds a run by id. A judge is told nothing about runs outside their assigned batches. */
export async function locateRun(id: string, judging: JudgingContext): Promise<RunLocation> {
  let location = (runIndex ?? (await refreshRunIndex())).locations.get(id);
  if (!location) location = (await refreshRunIndex()).locations.get(id);
  if (!location || !mayJudge(judging, location.batch) || !(await isDir(location.dir))) {
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
  batches.filter((batch) => mayJudge(judging, batch));

async function summarize(
  exam: string,
  sample: ManifestSample,
  batches: BatchState[],
  view: RunView
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
            view
          })
        )
    )
  ]);
  // Batches are sorted by name; a blind listing is ordered per viewer so the position says
  // nothing and two judges cannot line their lists up.
  if (view.blind || view.judging.role !== "owner") {
    const key = new Map(runs.map((run) => [run.id, blindOrder(view.judging.login, run.id)]));
    runs.sort((a, b) => key.get(a.id)!.localeCompare(key.get(b.id)!));
  }
  return { ...info, runs };
}

export async function listSamples(jobs: JobManager, view: RunView): Promise<SampleSummary[]> {
  const { manifest, batches } = await refreshRunIndex();
  const states = await batchStates(visibleBatches(batches, view.judging), jobs);
  return Promise.all(
    manifest.exams.flatMap((exam) =>
      exam.samples.map((sample) => summarize(exam.id, sample, states, view))
    )
  );
}

export async function getSample(
  stem: string,
  jobs: JobManager,
  view: RunView
): Promise<SampleSummary> {
  const { manifest, batches } = await refreshRunIndex();
  const exam = manifest.exams.find((e) => e.id === manifest.stems.get(stem));
  const sample = exam?.samples.find((s) => s.stem === stem);
  if (!exam || !sample) throw new HttpError(404, `no sample ${stem}`);
  const states = await batchStates(visibleBatches(batches, view.judging), jobs);
  return summarize(exam.id, sample, states, view);
}

const readFinishedRun = (location: RunLocation, view: RunView) =>
  readRun(location.batch, location.stem, { exists: true, running: false, progress: null, view });

/** Writes the requesting user's judgement and returns the run as they may see it. */
export async function saveJudgement(id: string, body: unknown, view: RunView): Promise<Run> {
  const parsed = JudgementSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `judgement: ${parsed.error.issues[0]!.message}`);
  const location = await locateRun(id, view.judging);
  const run = await readFinishedRun(location, view);
  if (!run.result) throw new HttpError(409, "run has not finished");
  if (!hasSubmission(run)) throw new HttpError(409, "no submission; already counted as a failure");
  if (!(await hasCrop(location.stem))) {
    throw new HttpError(409, "a reference crop is required to judge this submission");
  }
  await writeJudgement(location.dir, view.judging.login, parsed.data);
  return readFinishedRun(location, view);
}

// Deliberately skips the checks saving makes: a judgement left on a run that is no longer
// judgeable is exactly the one worth clearing. Only the user's own judgement is touched.
export async function clearJudgement(id: string, view: RunView): Promise<Run> {
  const location = await locateRun(id, view.judging);
  await removeJudgement(location.dir, view.judging.login);
  return readFinishedRun(location, view);
}

/** The assignment table with each judge's progress, for the owner's editor. */
export async function assignmentsView(): Promise<AssignmentsView> {
  const [assignments, users, batches] = await Promise.all([
    loadAssignments(),
    loadUsers(),
    listDirs(config.runsDir)
  ]);
  const judges = [...users].filter(([, role]) => role === "judge").map(([login]) => login);
  const judgeable = new Map<string, Promise<string[]>>();
  const judgeableStems = (batch: string) => {
    let pending = judgeable.get(batch);
    if (!pending) {
      pending = listJudgeable(batch);
      judgeable.set(batch, pending);
    }
    return pending;
  };
  const progress: AssignmentsView["progress"] = {};
  await Promise.all(
    Object.entries(assignments).map(async ([login, assigned]) => {
      const byBatch: Record<string, JudgeProgress> = {};
      await Promise.all(
        assigned.map(async (batch) => {
          const stems = await judgeableStems(batch);
          const judged = await Promise.all(
            stems.map((stem) =>
              isFile(judgementFile(path.join(config.runsDir, batch, stem), login))
            )
          );
          byBatch[batch] = { judged: judged.filter(Boolean).length, total: stems.length };
        })
      );
      progress[login] = byBatch;
    })
  );
  return { assignments, judges, batches, progress };
}

/** Stems in a batch with a submission and a reference crop, i.e. runs a judge can act on. */
async function listJudgeable(batch: string): Promise<string[]> {
  const dir = path.join(config.runsDir, batch);
  const stems = await listDirs(dir);
  const checks = await Promise.all(
    stems.map(async (stem) => {
      const runDir = path.join(dir, stem);
      const [{ result }, submitted, crop] = await Promise.all([
        readResult(runDir),
        isFile(path.join(runDir, "submission.png")),
        hasCrop(stem)
      ]);
      return result?.status === "submitted" && submitted && crop;
    })
  );
  return stems.filter((_, i) => checks[i]);
}
