import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  hasSubmission,
  JudgementSchema,
  type Judgement,
  type Run,
  type SampleSummary
} from "../shared/judge.ts";
import type { ManifestSample } from "../shared/types.ts";
import { isDir, isFile, listDirs, listRenders, readResult } from "./batches.ts";
import { config } from "./env.ts";
import { HttpError } from "./http.ts";
import { loadManifest, type LoadedManifest } from "./repo.ts";

const JUDGEMENT_FILE = "judgement.json";

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

export const runId = (batch: string, stem: string) =>
  createHash("sha256").update(`${batch}/${stem}`).digest("hex").slice(0, 12);

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

async function readJudgement(dir: string): Promise<Judgement | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, JUDGEMENT_FILE), "utf8"));
  } catch {
    return null;
  }
  const parsed = JudgementSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function readRun(batch: string, stem: string, blind: boolean): Promise<Run | null> {
  const dir = path.join(config.runsDir, batch, stem);
  if (!(await isDir(dir))) return null;
  const [{ result }, hasSubmission, renders, judgement] = await Promise.all([
    readResult(dir),
    isFile(path.join(dir, "submission.png")),
    listRenders(dir),
    readJudgement(dir)
  ]);
  return {
    id: runId(batch, stem),
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
    judgement,
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
            startedAt: result.startedAt
          }
        }
  };
}

async function summarize(
  exam: string,
  sample: ManifestSample,
  batches: string[],
  blind: boolean
): Promise<SampleSummary> {
  const [hasCrop, found] = await Promise.all([
    isFile(path.join(config.cropsDir, `${sample.stem}.png`)),
    Promise.all(batches.map((batch) => readRun(batch, sample.stem, blind)))
  ]);
  const runs = found.filter((run) => run !== null);
  // Batches are sorted by name; a blind listing orders by id so the position says nothing.
  if (blind) runs.sort((a, b) => a.id.localeCompare(b.id));
  return { ...sample, exam, hasCrop, runs };
}

export async function listSamples(blind: boolean): Promise<SampleSummary[]> {
  const { manifest, batches } = await refreshRunIndex();
  return Promise.all(
    manifest.exams.flatMap((exam) =>
      exam.samples.map((sample) => summarize(exam.id, sample, batches, blind))
    )
  );
}

export async function saveJudgement(id: string, body: unknown): Promise<Judgement> {
  const parsed = JudgementSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `judgement: ${parsed.error.issues[0]!.message}`);
  const location = await locateRun(id);
  const run = await readRun(location.batch, location.stem, false);
  if (!run) throw new HttpError(404, `no run ${id}`);
  if (!run.result) throw new HttpError(409, "run has not finished");
  if (!hasSubmission(run)) throw new HttpError(409, "no submission; already counted as a failure");
  if (!(await isFile(path.join(config.cropsDir, `${location.stem}.png`)))) {
    throw new HttpError(409, "a reference crop is required to judge this submission");
  }
  await writeFile(
    path.join(location.dir, JUDGEMENT_FILE),
    `${JSON.stringify(parsed.data, null, 2)}\n`
  );
  return parsed.data;
}
