import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCommand, numberParser } from "@stricli/core";
import {
  bootstrapIntervals,
  centre,
  fitBradleyTerry,
  winProbability,
  type Comparison,
  type Interval
} from "../bradleyterry.ts";
import { pairKey, readOutcomes, sampleDir, type StoredOutcome } from "../comparisons.ts";
import type { LocalContext } from "../context.ts";
import { parseManifest, sampleStem, type Category } from "../manifest.ts";
import { RESULT_FILE, type RunResult } from "../output.ts";
import {
  DEFAULT_ASSIGNMENTS_FILE,
  DEFAULT_COMPARISONS_DIR,
  DEFAULT_MANIFEST,
  DEFAULT_RUNS_DIR
} from "../paths.ts";

interface ReportFlags {
  readonly manifest: string;
  readonly runs: string;
  readonly comparisons: string;
  readonly assignments: string;
  readonly batch: readonly string[];
  readonly baseline?: string;
  readonly json?: string;
  readonly replicates: number;
  readonly seed: number;
}

/** A run of one batch on one sample, as far as the report cares. */
interface RunInfo {
  readonly batch: string;
  readonly item: string;
  readonly submitted: boolean;
}

interface Sample {
  readonly stem: string;
  readonly category: Category;
  /** Keyed by batch; a batch that has not run the sample is absent. */
  readonly runs: Map<string, RunInfo>;
  readonly outcomes: StoredOutcome[];
}

interface ItemRow {
  item: string;
  batches: string[];
  runs: number;
  failed: number;
  comparisons: number;
  score: number | null;
  interval: Interval | null;
  /** Fitted chance of beating the baseline. */
  vsBaseline: number | null;
}

interface Scope {
  name: string;
  samples: number;
  anchor: string | null;
  rows: ItemRow[];
}

interface Agreement {
  /** Pairs with outcomes from two or more judges. */
  pairs: number;
  /** Fraction where every judge chose the same. */
  strict: number | null;
  /** Fraction where no two judges chose opposite sides; a tie agrees with either. */
  lenient: number | null;
}

interface Report {
  pool: string[];
  baseline: string | null;
  skipped: { staleComparisons: number; sameModelComparisons: number; missingBatches: string[] };
  scopes: Scope[];
  agreement: Agreement;
}

const itemOf = (result: RunResult) => `${result.provider}/${result.model} ${result.reasoning}`;

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false
  );

async function readRun(runsDir: string, batch: string, stem: string): Promise<RunInfo | null> {
  const dir = join(runsDir, batch, stem);
  let result: RunResult;
  try {
    result = JSON.parse(await readFile(join(dir, RESULT_FILE), "utf8")) as RunResult;
  } catch {
    return null;
  }
  const submitted = result.status === "submitted" && (await exists(join(dir, "submission.png")));
  return { batch, item: itemOf(result), submitted };
}

async function loadPool(flags: ReportFlags): Promise<string[]> {
  if (flags.batch.length > 0) return [...new Set(flags.batch)].sort();
  let assignments: Record<string, string[]>;
  try {
    assignments = JSON.parse(await readFile(flags.assignments, "utf8")) as Record<string, string[]>;
  } catch (e) {
    throw new Error(
      `cannot read ${flags.assignments} (${e instanceof Error ? e.message : String(e)}); ` +
        "name the pool with --batch instead"
    );
  }
  return [...new Set(Object.values(assignments).flat())].sort();
}

async function loadSamples(flags: ReportFlags, pool: readonly string[]): Promise<Sample[]> {
  const manifest = parseManifest(JSON.parse(await readFile(flags.manifest, "utf8")));
  const samples: Sample[] = [];
  for (const exam of manifest) {
    for (const sample of exam.samples) {
      const stem = sampleStem(exam, sample);
      const [runs, outcomes] = await Promise.all([
        Promise.all(pool.map((batch) => readRun(flags.runs, batch, stem))),
        readOutcomes(sampleDir(flags.comparisons, stem))
      ]);
      samples.push({
        stem,
        category: sample.category,
        runs: new Map(runs.filter((run) => run !== null).map((run) => [run.batch, run])),
        outcomes
      });
    }
  }
  return samples;
}

interface Gathered {
  comparisons: Comparison[];
  /** Human comparisons per item, counted for the table. */
  counted: Map<string, number>;
  stale: number;
  sameModel: number;
}

/**
 * Human outcomes become one comparison each. A run that failed loses to every submitted run
 * on its sample and ties with every other failure, weighted so that its comparisons carry the
 * same total weight as a submitted run's human comparisons on that sample do on average.
 */
function gather(samples: readonly Sample[]): Gathered {
  const comparisons: Comparison[] = [];
  const counted = new Map<string, number>();
  let stale = 0;
  let sameModel = 0;
  const count = (item: string) => counted.set(item, (counted.get(item) ?? 0) + 1);

  for (const sample of samples) {
    const submitted = [...sample.runs.values()].filter((run) => run.submitted);
    const failed = [...sample.runs.values()].filter((run) => !run.submitted);
    let appearances = 0;
    for (const outcome of sample.outcomes) {
      const a = sample.runs.get(outcome.a);
      const b = sample.runs.get(outcome.b);
      if (!a?.submitted || !b?.submitted) {
        stale++;
        continue;
      }
      appearances += 2;
      if (a.item === b.item) {
        sameModel++;
        continue;
      }
      count(a.item);
      count(b.item);
      comparisons.push({
        a: a.item,
        b: b.item,
        outcome: outcome.outcome,
        weight: 1,
        group: sample.stem
      });
    }
    if (failed.length === 0 || submitted.length === 0 || appearances === 0) continue;
    const opponents = submitted.length + failed.length - 1;
    const weight = appearances / submitted.length / opponents;
    for (const loser of failed) {
      for (const winner of submitted) {
        if (winner.item === loser.item) continue;
        comparisons.push({
          a: winner.item,
          b: loser.item,
          outcome: "a",
          weight,
          group: sample.stem
        });
      }
    }
    for (let i = 0; i < failed.length; i++) {
      for (let j = i + 1; j < failed.length; j++) {
        const x = failed[i]!;
        const y = failed[j]!;
        if (x.item === y.item) continue;
        comparisons.push({ a: x.item, b: y.item, outcome: "tie", weight, group: sample.stem });
      }
    }
  }
  return { comparisons, counted, stale, sameModel };
}

function scope(
  name: string,
  samples: readonly Sample[],
  baseline: string | null,
  flags: ReportFlags
): Scope {
  const stats = new Map<string, { batches: Set<string>; runs: number; failed: number }>();
  for (const sample of samples) {
    for (const run of sample.runs.values()) {
      let item = stats.get(run.item);
      if (!item) stats.set(run.item, (item = { batches: new Set(), runs: 0, failed: 0 }));
      item.batches.add(run.batch);
      item.runs++;
      if (!run.submitted) item.failed++;
    }
  }
  const items = [...stats.keys()].sort();
  const { comparisons, counted } = gather(samples);
  const anchor = baseline !== null && counted.has(baseline) ? baseline : null;
  const scores = centre(fitBradleyTerry(items, comparisons), anchor);
  const intervals = bootstrapIntervals(items, comparisons, {
    replicates: flags.replicates,
    seed: flags.seed,
    relativeTo: anchor
  });
  const rows = items.map((item): ItemRow => {
    const { batches, runs, failed } = stats.get(item)!;
    const compared = (counted.get(item) ?? 0) > 0;
    const score = compared ? scores.get(item)! : null;
    return {
      item,
      batches: [...batches].sort(),
      runs,
      failed,
      comparisons: counted.get(item) ?? 0,
      score,
      interval: compared ? intervals.get(item)! : null,
      vsBaseline:
        score !== null && anchor !== null ? winProbability(score, scores.get(anchor)!) : null
    };
  });
  rows.sort(
    (x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity) || x.item.localeCompare(y.item)
  );
  return { name, samples: samples.length, anchor, rows };
}

function agreement(samples: readonly Sample[]): Agreement {
  let pairs = 0;
  let strict = 0;
  let lenient = 0;
  for (const sample of samples) {
    for (const outcomes of Map.groupBy(sample.outcomes, pairKey).values()) {
      if (outcomes.length < 2) continue;
      pairs++;
      const choices = new Set(outcomes.map((o) => o.outcome));
      if (choices.size === 1) strict++;
      choices.delete("tie");
      if (choices.size <= 1) lenient++;
    }
  }
  return {
    pairs,
    strict: pairs === 0 ? null : strict / pairs,
    lenient: pairs === 0 ? null : lenient / pairs
  };
}

function table(rows: readonly string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)))
        .join("  ")
    )
    .join("\n");
}

const fixed = (n: number | null, digits: number) => (n === null ? "—" : n.toFixed(digits));
const percent = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

function render(report: Report): string {
  const out: string[] = [];
  out.push(`pool: ${report.pool.join(", ")}`);
  out.push(`baseline: ${report.baseline ?? "none (scores centred on their mean)"}`);
  if (report.skipped.missingBatches.length > 0) {
    out.push(`warning: no runs found for ${report.skipped.missingBatches.join(", ")}`);
  }
  if (report.skipped.staleComparisons > 0) {
    out.push(
      `warning: skipped ${report.skipped.staleComparisons} comparisons whose runs are no longer submitted or in the pool`
    );
  }
  if (report.skipped.sameModelComparisons > 0) {
    out.push(
      `note: ${report.skipped.sameModelComparisons} comparisons between repeats of one model carry no ranking information and are left out of the fit`
    );
  }
  for (const scope of report.scopes) {
    if (scope.rows.length === 0) continue;
    out.push("");
    out.push(`## ${scope.name} (${scope.samples} samples)`);
    if (report.baseline !== null && scope.anchor === null) {
      out.push(
        `note: ${report.baseline} has no comparisons here, so these scores are centred on ` +
          "their mean instead and do not line up with the other scopes'"
      );
    }
    out.push(
      table([
        ["model", "batches", "runs", "failed", "compared", "score", "95% interval", "vs baseline"],
        ...scope.rows.map((row) => [
          row.item,
          String(row.batches.length),
          String(row.runs),
          String(row.failed),
          String(row.comparisons),
          fixed(row.score, 2),
          row.interval && row.item !== scope.anchor
            ? `${fixed(row.interval.low, 2)} to ${fixed(row.interval.high, 2)}`
            : "—",
          percent(row.vsBaseline)
        ])
      ])
    );
  }
  out.push("");
  out.push(
    `judge agreement over ${report.agreement.pairs} pairs judged by two or more: ` +
      `${percent(report.agreement.strict)} strict, ${percent(report.agreement.lenient)} with ties agreeing either way`
  );
  return `${out.join("\n")}\n`;
}

export const reportCommand = buildCommand({
  async func(this: LocalContext, flags: ReportFlags): Promise<void> {
    const pool = await loadPool(flags);
    if (pool.length === 0) throw new Error("the pool is empty: assign batches or pass --batch");
    let baseline: string | null = null;
    const samples = await loadSamples(flags, pool);
    const present = new Set<string>();
    for (const sample of samples) for (const batch of sample.runs.keys()) present.add(batch);
    if (flags.baseline !== undefined) {
      if (!pool.includes(flags.baseline)) {
        throw new Error(`baseline ${flags.baseline} is not in the pool`);
      }
      for (const sample of samples) {
        const run = sample.runs.get(flags.baseline);
        if (run) {
          baseline = run.item;
          break;
        }
      }
      if (baseline === null) throw new Error(`baseline ${flags.baseline} has no runs`);
    }

    const { stale, sameModel } = gather(samples);
    const categories = [...new Set(samples.map((s) => s.category))].sort();
    const report: Report = {
      pool,
      baseline,
      skipped: {
        staleComparisons: stale,
        sameModelComparisons: sameModel,
        missingBatches: pool.filter((batch) => !present.has(batch))
      },
      scopes: [
        scope("overall", samples, baseline, flags),
        ...categories.map((category) =>
          scope(
            category,
            samples.filter((s) => s.category === category),
            baseline,
            flags
          )
        )
      ],
      agreement: agreement(samples)
    };
    if (flags.json !== undefined) {
      await writeFile(flags.json, `${JSON.stringify(report, null, 2)}\n`);
    }
    this.process.stdout.write(render(report));
  },
  parameters: {
    flags: {
      manifest: {
        kind: "parsed",
        parse: String,
        brief: "Dataset manifest",
        default: DEFAULT_MANIFEST
      },
      runs: { kind: "parsed", parse: String, brief: "Runs directory", default: DEFAULT_RUNS_DIR },
      comparisons: {
        kind: "parsed",
        parse: String,
        brief: "Comparisons directory",
        default: DEFAULT_COMPARISONS_DIR
      },
      assignments: {
        kind: "parsed",
        parse: String,
        brief: "Assignments file the pool is read from",
        default: DEFAULT_ASSIGNMENTS_FILE
      },
      batch: {
        kind: "parsed",
        parse: String,
        variadic: true,
        brief: "Batches making up the pool, instead of every assigned batch",
        default: []
      },
      baseline: {
        kind: "parsed",
        parse: String,
        brief: "Batch whose model scores zero and is the yardstick for win rates",
        optional: true
      },
      json: {
        kind: "parsed",
        parse: String,
        brief: "Write the full report as JSON to this file",
        optional: true
      },
      replicates: {
        kind: "parsed",
        parse: numberParser,
        brief: "Bootstrap replicates for the intervals",
        default: "1000"
      },
      seed: {
        kind: "parsed",
        parse: numberParser,
        brief: "Bootstrap seed",
        default: "0"
      }
    }
  },
  docs: {
    brief: "Rank models by Bradley-Terry over the pairwise comparisons."
  }
});
