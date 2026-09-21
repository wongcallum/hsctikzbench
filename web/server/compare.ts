import { createHash, createHmac } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  orderPair,
  outcomesFile,
  pairKey,
  pairsFile,
  readJudgeOutcomes,
  readPairs,
  sampleDir,
  serializeOutcome,
  serializePairs,
  type Outcome,
  type Pair,
  type StoredOutcome
} from "hsctikzbench-cli/comparisons";
import { OutcomeInputSchema } from "../shared/compare.ts";
import type {
  AssignmentsView,
  ComparePair,
  CompareSample,
  JudgeProgress,
  ManifestSample
} from "../shared/types.ts";
import { judgesByBatch, loadAssignments } from "./assignments.ts";
import { hasCrop, isFile, listDirs, readResult, sampleInfo } from "./batches.ts";
import { config } from "./env.ts";
import { HttpError } from "./http.ts";
import { locateRun } from "./judge.ts";
import { runId, type JudgingContext } from "./judgements.ts";
import { loadManifest } from "./repo.ts";
import { loadUsers, loginKey } from "./users.ts";

/** Batches in play for pairs: everything assigned to anyone. */
export async function poolBatches(): Promise<string[]> {
  const assignments = await loadAssignments();
  return [...new Set(Object.values(assignments).flat())].sort();
}

/** Runs a judge can be shown: submitted with an image, on a sample with a reference. */
async function eligibleRuns(stem: string, batches: readonly string[]): Promise<string[]> {
  if (!(await hasCrop(stem))) return [];
  const checks = await Promise.all(
    batches.map(async (batch) => {
      const dir = path.join(config.runsDir, batch, stem);
      const [{ result }, submitted] = await Promise.all([
        readResult(dir),
        isFile(path.join(dir, "submission.png"))
      ]);
      return result?.status === "submitted" && submitted;
    })
  );
  return batches.filter((_, i) => checks[i]);
}

/** Uniform in [0, 1), reproducible from the seed. */
function seededRandom(seed: string): () => number {
  let n = 0;
  return () => createHash("sha256").update(`${seed}:${n++}`).digest().readUInt32BE(0) / 2 ** 32;
}

/**
 * Pairs to add so that every eligible run appears in at least `perRun` pairs with another
 * eligible run. The run furthest below the minimum is paired with a uniformly random partner
 * it has not met, until it reaches the minimum or has met everyone. Seeded by the sample and
 * how many pairs it already has, so drawing the same state twice gives the same pairs.
 */
export function drawPairs(
  stem: string,
  existing: readonly Pair[],
  eligible: readonly string[],
  perRun: number
): Pair[] {
  const runs = [...eligible].sort();
  const inPlay = new Set(runs);
  const counts = new Map(runs.map((run) => [run, 0]));
  const seen = new Set<string>();
  const bump = (pair: Pair) => {
    seen.add(pairKey(pair));
    if (inPlay.has(pair.a) && inPlay.has(pair.b)) {
      counts.set(pair.a, counts.get(pair.a)! + 1);
      counts.set(pair.b, counts.get(pair.b)! + 1);
    }
  };
  for (const pair of existing) bump(pair);

  const random = seededRandom(`${stem}:${existing.length}`);
  const drawn: Pair[] = [];
  const saturated = new Set<string>();
  for (;;) {
    let short: string | null = null;
    for (const run of runs) {
      if (saturated.has(run) || counts.get(run)! >= perRun) continue;
      if (short === null || counts.get(run)! < counts.get(short)!) short = run;
    }
    if (short === null) break;
    const partners = runs.filter(
      (run) => run !== short && !seen.has(pairKey(orderPair(short, run)))
    );
    if (partners.length === 0) {
      saturated.add(short);
      continue;
    }
    const pair = orderPair(short, partners[Math.floor(random() * partners.length)]!);
    drawn.push(pair);
    bump(pair);
  }
  return drawn;
}

// Drawing reads the pairs file and writes it back, and outcomes are appended and rewound, so
// work on one sample is serialised. The server is a single process.
const locks = new Map<string, Promise<unknown>>();

function withSample<T>(stem: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(stem) ?? Promise.resolve();
  const next = previous.then(work, work);
  locks.set(
    stem,
    next.catch(() => undefined)
  );
  return next;
}

interface SampleState {
  eligible: Set<string>;
  pairs: Pair[];
}

/** The sample's pairs, drawn up to the minimum for every eligible run in the pool. */
async function ensurePairs(stem: string, pool: readonly string[]): Promise<SampleState> {
  const dir = sampleDir(config.comparisonsDir, stem);
  const [eligible, existing] = await Promise.all([eligibleRuns(stem, pool), readPairs(dir)]);
  const drawn = drawPairs(stem, existing, eligible, config.comparisonsPerRun);
  const pairs = [...existing, ...drawn];
  if (drawn.length > 0) {
    await mkdir(dir, { recursive: true });
    await writeFile(pairsFile(dir), serializePairs(pairs));
  }
  return { eligible: new Set(eligible), pairs };
}

/** Which side the judge sees the pair's `b` on. Fixed per judge so reloads do not swap it. */
const showsBLeft = (login: string, stem: string, pair: Pair) =>
  (createHmac("sha256", loginKey(login)).update(`${stem}/${pair.a}/${pair.b}`).digest()[0]! & 1) ===
  1;

function shown(login: string, stem: string, pair: Pair): ComparePair {
  const a = runId(pair.a, stem);
  const b = runId(pair.b, stem);
  return showsBLeft(login, stem, pair) ? { left: b, right: a } : { left: a, right: b };
}

async function compareSample(
  stem: string,
  exam: string,
  meta: ManifestSample | null,
  pool: readonly string[],
  judging: JudgingContext
): Promise<CompareSample> {
  const [info, state, outcomes] = await Promise.all([
    sampleInfo(stem, exam, meta),
    ensurePairs(stem, pool),
    readJudgeOutcomes(sampleDir(config.comparisonsDir, stem), loginKey(judging.login))
  ]);
  const servable = state.pairs.filter(
    (pair) =>
      state.eligible.has(pair.a) &&
      state.eligible.has(pair.b) &&
      judging.batches.has(pair.a) &&
      judging.batches.has(pair.b)
  );
  const judged = new Set(outcomes.map(pairKey));
  const pending = servable.filter((pair) => !judged.has(pairKey(pair)));
  return {
    ...info,
    pending: pending.map((pair) => shown(judging.login, stem, pair)),
    done: servable.length - pending.length,
    total: servable.length
  };
}

async function locateSample(stem: string) {
  const manifest = await loadManifest();
  const exam = manifest.exams.find((e) => e.id === manifest.stems.get(stem));
  const sample = exam?.samples.find((s) => s.stem === stem);
  if (!exam || !sample) throw new HttpError(404, `no sample ${stem}`);
  return { exam: exam.id, sample };
}

export async function listCompare(judging: JudgingContext): Promise<CompareSample[]> {
  const [manifest, pool] = await Promise.all([loadManifest(), poolBatches()]);
  return Promise.all(
    manifest.exams.flatMap((exam) =>
      exam.samples.map((sample) =>
        withSample(sample.stem, () => compareSample(sample.stem, exam.id, sample, pool, judging))
      )
    )
  );
}

export async function getCompare(stem: string, judging: JudgingContext): Promise<CompareSample> {
  const [{ exam, sample }, pool] = await Promise.all([locateSample(stem), poolBatches()]);
  return withSample(stem, () => compareSample(stem, exam, sample, pool, judging));
}

function parseOutcome(body: unknown) {
  const parsed = OutcomeInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `outcome: ${parsed.error.issues[0]!.message}`);
  return parsed.data;
}

/** Records which side the judge chose, translated back to the pair as stored. Runs are
 * located as if blind, so a batch the judge is not assigned cannot be named. */
export async function recordOutcome(
  stem: string,
  body: unknown,
  judging: JudgingContext
): Promise<CompareSample> {
  const input = parseOutcome(body);
  const [{ exam, sample }, pool] = await Promise.all([locateSample(stem), poolBatches()]);
  const view = { blind: true, judging };
  const [left, right] = await Promise.all([
    locateRun(input.left, view),
    locateRun(input.right, view)
  ]);
  if (left.stem !== stem || right.stem !== stem)
    throw new HttpError(400, "runs are not of this sample");
  if (left.batch === right.batch) throw new HttpError(400, "a pair needs two runs");
  const pair = orderPair(left.batch, right.batch);
  const outcome: Outcome =
    input.outcome === "tie"
      ? "tie"
      : (input.outcome === "left" ? left.batch : right.batch) === pair.a
        ? "a"
        : "b";

  return withSample(stem, async () => {
    const dir = sampleDir(config.comparisonsDir, stem);
    const login = loginKey(judging.login);
    const [pairs, outcomes] = await Promise.all([readPairs(dir), readJudgeOutcomes(dir, login)]);
    if (!pairs.some((p) => pairKey(p) === pairKey(pair))) {
      throw new HttpError(409, "this pair was not drawn for the sample");
    }
    if (outcomes.some((o) => pairKey(o) === pairKey(pair))) {
      throw new HttpError(409, "you have already judged this pair");
    }
    const stored: StoredOutcome = { ...pair, outcome, judgedAt: new Date().toISOString() };
    await mkdir(dir, { recursive: true });
    await appendFile(outcomesFile(dir, login), serializeOutcome(stored));
    return compareSample(stem, exam, sample, pool, judging);
  });
}

/** Drops the judge's most recent outcome on the sample, whichever pair it was. */
export async function undoOutcome(stem: string, judging: JudgingContext): Promise<CompareSample> {
  const [{ exam, sample }, pool] = await Promise.all([locateSample(stem), poolBatches()]);
  return withSample(stem, async () => {
    const dir = sampleDir(config.comparisonsDir, stem);
    const login = loginKey(judging.login);
    const outcomes = await readJudgeOutcomes(dir, login);
    if (outcomes.length === 0) throw new HttpError(409, "nothing to undo on this sample");
    const kept = outcomes.slice(0, -1);
    const file = outcomesFile(dir, login);
    if (kept.length === 0) await rm(file, { force: true });
    else await writeFile(file, kept.map(serializeOutcome).join(""));
    return compareSample(stem, exam, sample, pool, judging);
  });
}

export async function assignmentsView(): Promise<AssignmentsView> {
  const [assignments, users, batches] = await Promise.all([
    loadAssignments(),
    loadUsers(),
    listDirs(config.runsDir)
  ]);
  const judges = judgesByBatch(assignments);
  const progress: Record<string, JudgeProgress> = {};
  await Promise.all(
    Object.entries(assignments).map(async ([login, assigned]) => {
      const samples = await listCompare({
        login,
        role: users.get(login) ?? "judge",
        batches: new Set(assigned),
        judges
      });
      const total: JudgeProgress = { done: 0, total: 0 };
      for (const sample of samples) {
        total.done += sample.done;
        total.total += sample.total;
      }
      progress[login] = total;
    })
  );
  return { assignments, users: Object.fromEntries(users), batches, progress };
}
