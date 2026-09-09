import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommand, numberParser } from "@stricli/core";
import pMap from "p-map";
import { prepareAgent, agentFlags, type AgentFlags } from "../agent.ts";
import type { LocalContext } from "../context.ts";
import { runAgent } from "../loop.ts";
import { examId, parseManifest, sampleStem, type Exam, type Sample } from "../manifest.ts";
import { OutputDir, type RunResult, type RunStatus } from "../output.ts";
import { openProgress, type SampleOutcome } from "../progress.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DATASET_DIR = join(REPO_ROOT, "dataset");
const DATA_DIR = join(REPO_ROOT, "data");

interface BenchFlags extends AgentFlags {
  readonly manifest: string;
  readonly crops: string;
  readonly out: string;
  readonly exam: readonly string[];
  readonly sample: readonly string[];
  readonly jobs: number;
  readonly resume: boolean;
  readonly progressFd?: number;
}

interface Job {
  readonly exam: Exam;
  readonly sample: Sample;
  readonly stem: string;
}

type Outcome =
  | { kind: "skipped" }
  | { kind: "failed"; message: string }
  | { kind: "ran"; result: RunResult; retriedAfter?: string };

export const benchCommand = buildCommand({
  async func(this: LocalContext, flags: BenchFlags): Promise<void> {
    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    const out = (line: string) => this.process.stdout.write(`${line}\n`);
    if (!Number.isInteger(flags.jobs) || flags.jobs < 1) {
      throw new Error("--jobs must be a positive integer");
    }

    const manifest = parseManifest(JSON.parse(await readFile(flags.manifest, "utf8")));
    const jobs = selectJobs(manifest, flags);
    if (jobs.length === 0) throw new Error("no samples selected");
    const progress = openProgress(flags.progressFd);

    const { models, model, authSource, renderer, systemPrompt } = await prepareAgent(flags);
    log(`auth: ${authSource}`);
    log(`renderer: ${renderer.description}`);
    log(`${jobs.length} samples, ${flags.jobs} jobs, output in ${flags.out}`);
    progress({ type: "start", stems: jobs.map((j) => j.stem), maxTurns: flags.maxTurns });

    const outcomes = new Map<string, Outcome>();
    let done = 0;
    const runOne = async (job: Job): Promise<Outcome> => {
      const dir = new OutputDir(join(flags.out, job.stem));
      let retriedAfter: string | undefined;
      if (flags.resume) {
        const previous = await dir.previousResult();
        // max_turns is a real outcome and stays skipped; an errored run measured nothing.
        if (previous && previous.status !== "error") return { kind: "skipped" };
        if (previous) {
          retriedAfter = previous.error ?? "no message recorded";
          out(`RETRYING ${job.stem}: earlier run errored (${retriedAfter})`);
        }
      }
      const referencePng = await loadCrop(flags.crops, job);
      // Under --resume a directory with no result to keep was interrupted or errored; start over.
      await dir.prepare(referencePng, { replace: flags.resume });
      const result = await runAgent({
        models,
        model,
        reasoning: flags.reasoning,
        renderer,
        maxTurns: flags.maxTurns,
        systemPrompt,
        referencePng,
        out: dir,
        log: (line) => log(`[${job.stem}] ${line}`),
        onTurn: (turn) => progress({ type: "turn", stem: job.stem, ...turn })
      });
      return { kind: "ran", result, retriedAfter };
    };
    await pMap(
      jobs,
      async (job) => {
        let outcome: Outcome;
        try {
          outcome = await runOne(job);
        } catch (e) {
          outcome = { kind: "failed", message: e instanceof Error ? e.message : String(e) };
        }
        outcomes.set(job.stem, outcome);
        done++;
        log(`[${job.stem}] ${describe(outcome)}  (${done}/${jobs.length})`);
        progress({ type: "done", stem: job.stem, done, total: jobs.length, ...summarize(outcome) });
      },
      { concurrency: flags.jobs }
    );

    const counts: Record<RunStatus | "skipped" | "failed", number> = {
      submitted: 0,
      max_turns: 0,
      error: 0,
      skipped: 0,
      failed: 0
    };
    let cost = 0;
    let retried = 0;
    for (const stem of [...outcomes.keys()].sort()) {
      const outcome = outcomes.get(stem)!;
      if (outcome.kind === "ran") {
        counts[outcome.result.status]++;
        cost += outcome.result.usage.cost;
        if (outcome.retriedAfter !== undefined) retried++;
      } else {
        counts[outcome.kind]++;
      }
      out(`${stem}: ${describe(outcome)}`);
    }
    out(
      `${counts.submitted} submitted, ${counts.max_turns} hit max turns, ${counts.error} errored, ` +
        `${counts.failed} failed to start, ${counts.skipped} skipped, ` +
        `${retried} retried after an earlier error; cost $${cost.toFixed(4)}`
    );
    if (counts.error > 0 || counts.failed > 0) this.process.exitCode = 1;
    await progress.close();
  },
  parameters: {
    flags: {
      ...agentFlags,
      manifest: {
        kind: "parsed",
        parse: String,
        brief: "Path to the dataset manifest",
        default: join(DATASET_DIR, "manifest.json")
      },
      crops: {
        kind: "parsed",
        parse: String,
        brief: "Directory holding <stem>.png for each sample, as written by dataset build",
        default: join(DATA_DIR, "crops")
      },
      out: {
        kind: "parsed",
        parse: String,
        brief: "Directory to write one run directory per sample into, named by sample stem"
      },
      exam: {
        kind: "parsed",
        parse: String,
        brief: "Only run samples from this exam, given as <year>-<course>; repeatable",
        variadic: true,
        default: []
      },
      sample: {
        kind: "parsed",
        parse: String,
        brief: "Only run the sample with this stem; repeatable",
        variadic: true,
        default: []
      },
      jobs: {
        kind: "parsed",
        parse: numberParser,
        brief: "Number of samples run concurrently",
        default: "4"
      },
      resume: {
        kind: "boolean",
        brief:
          "Skip samples that already produced a result, and rerun ones that were interrupted " +
          "or that errored",
        default: false
      },
      progressFd: {
        kind: "parsed",
        parse: numberParser,
        brief: "File descriptor to write one JSON progress event per line to",
        optional: true
      }
    }
  },
  docs: {
    brief: "Run the benchmark on every dataset sample, several at a time."
  }
});

function selectJobs(manifest: readonly Exam[], flags: BenchFlags): Job[] {
  const exams = new Set(flags.exam);
  for (const id of exams) {
    if (!manifest.some((e) => examId(e) === id)) {
      throw new Error(`no exam ${id} in manifest. Known exams: ${manifest.map(examId).join(", ")}`);
    }
  }
  const jobs: Job[] = [];
  for (const exam of manifest) {
    if (exams.size > 0 && !exams.has(examId(exam))) continue;
    for (const sample of exam.samples) jobs.push({ exam, sample, stem: sampleStem(exam, sample) });
  }
  if (flags.sample.length === 0) return jobs;

  const stems = new Set(flags.sample);
  for (const stem of stems) {
    if (!jobs.some((j) => j.stem === stem)) throw new Error(`no sample ${stem} in selection`);
  }
  return jobs.filter((j) => stems.has(j.stem));
}

/** Reads the sample's crop and checks it against the digest recorded in the manifest. */
async function loadCrop(cropsDir: string, { sample, stem }: Job): Promise<Buffer> {
  const file = join(cropsDir, `${stem}.png`);
  let png: Buffer;
  try {
    png = await readFile(file);
  } catch (e) {
    throw new Error(
      `missing crop ${file} (${e instanceof Error ? e.message : String(e)}); run dataset build first`
    );
  }
  if (sample.output) {
    const digest = createHash("sha256").update(png).digest("hex");
    if (digest !== sample.output.sha256) {
      throw new Error(
        `crop ${file} has sha256 ${digest}, manifest expects ${sample.output.sha256}; rerun dataset build`
      );
    }
  }
  return png;
}

function summarize(outcome: Outcome): {
  outcome: SampleOutcome;
  turns: number | null;
  cost: number | null;
  message: string | null;
} {
  switch (outcome.kind) {
    case "skipped":
      return { outcome: "skipped", turns: null, cost: null, message: null };
    case "failed":
      return { outcome: "failed", turns: null, cost: null, message: outcome.message };
    case "ran": {
      const { result } = outcome;
      return {
        outcome: result.status,
        turns: result.turns,
        cost: result.usage.cost,
        message: result.error ?? null
      };
    }
  }
}

function describe(outcome: Outcome): string {
  switch (outcome.kind) {
    case "skipped":
      return "skipped";
    case "failed":
      return `failed: ${outcome.message}`;
    case "ran": {
      const { result } = outcome;
      const detail = result.status === "error" ? `: ${result.error}` : "";
      const retried = outcome.retriedAfter === undefined ? "" : "  RETRIED after an earlier error";
      return `${result.status}${detail}  turns=${result.turns} cost=$${result.usage.cost.toFixed(4)}${retried}`;
    }
  }
}
