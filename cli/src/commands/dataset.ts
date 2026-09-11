import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";
import pMap from "p-map";
import type { LocalContext } from "../context.ts";
import {
  examId,
  parseManifest,
  sampleStem,
  serializeManifest,
  type Exam,
  type Sample
} from "../manifest.ts";
import { DEFAULT_CROPS_DIR, DEFAULT_MANIFEST, DEFAULT_PDFS_DIR } from "../paths.ts";
import { crop } from "../render.ts";
import { createRenderer, rendererFlags, type Renderer, type RendererFlags } from "../renderer.ts";

const manifestFlag = {
  kind: "parsed",
  parse: String,
  brief: "Path to the dataset manifest",
  default: DEFAULT_MANIFEST
} as const;

const pdfsFlag = {
  kind: "parsed",
  parse: String,
  brief: "Directory holding <year>-<course>.pdf for each exam",
  default: DEFAULT_PDFS_DIR
} as const;

const onlyFlag = {
  kind: "parsed",
  parse: String,
  brief: "Restrict to a single exam, given as <year>-<course>",
  optional: true
} as const;

interface BuildFlags extends RendererFlags {
  readonly manifest: string;
  readonly pdfs: string;
  readonly out: string;
  readonly only?: string;
  readonly jobs: number;
  readonly writeDigests: boolean;
}

type Outcome =
  | { kind: "ok"; message?: string }
  | { kind: "mismatch"; message: string }
  | { kind: "failed"; message: string };

interface Job {
  readonly sample: Sample;
  readonly stem: string;
  readonly pdf: Buffer;
}

const buildCommandDef = buildCommand({
  async func(this: LocalContext, flags: BuildFlags): Promise<void> {
    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    const out = (line: string) => this.process.stdout.write(`${line}\n`);

    const manifest = await readManifest(flags.manifest);
    const exams = selectExams(manifest, flags.only);
    checkJobs(flags.jobs);

    const renderer = await createRenderer(flags);
    await renderer.prepare();
    log(`renderer: ${renderer.description}`);
    await mkdir(flags.out, { recursive: true });

    const outcomes = new Map<string, Outcome>();
    const jobs: Job[] = [];
    const preparedExams = new Set<string>();
    for (const exam of exams) {
      const id = examId(exam);
      const pdfPath = join(flags.pdfs, `${id}.pdf`);
      let pdf: Buffer;
      try {
        pdf = await readFile(pdfPath);
      } catch (err) {
        const message =
          `missing PDF ${pdfPath} (${err instanceof Error ? err.message : String(err)}); ` +
          "run `dataset fetch` to download it";
        for (const s of exam.samples)
          outcomes.set(sampleStem(exam, s), { kind: "failed", message });
        continue;
      }
      const actual = sha256(pdf);
      if (actual !== exam.sha256) {
        const message = `PDF ${pdfPath} has sha256 ${actual}, manifest expects ${exam.sha256}`;
        for (const s of exam.samples)
          outcomes.set(sampleStem(exam, s), { kind: "failed", message });
        continue;
      }
      preparedExams.add(id);
      for (const sample of exam.samples) jobs.push({ sample, stem: sampleStem(exam, sample), pdf });
    }
    log(`${jobs.length} samples across ${preparedExams.size} exams, ${flags.jobs} jobs`);

    let done = 0;
    await pMap(
      jobs,
      async (job) => {
        let outcome: Outcome;
        try {
          outcome = await buildOne(flags, renderer, job.pdf, job);
        } catch (error) {
          outcome = {
            kind: "failed",
            message: error instanceof Error ? error.message : String(error)
          };
        }
        outcomes.set(job.stem, outcome);
        done++;
        if (outcome.kind !== "ok") log(`${outcome.kind}: ${job.stem}: ${outcome.message}`);
        if (done % 25 === 0 || done === jobs.length) log(`${done}/${jobs.length}`);
      },
      { concurrency: flags.jobs }
    );

    if (flags.writeDigests) {
      await writeFile(flags.manifest, serializeManifest(manifest));
      log(`wrote digests to ${flags.manifest}`);
    }

    const counts = { ok: 0, mismatch: 0, failed: 0 };
    for (const stem of [...outcomes.keys()].sort()) {
      const outcome = outcomes.get(stem)!;
      counts[outcome.kind]++;
      if (outcome.kind !== "ok") out(`${outcome.kind}: ${stem}: ${outcome.message}`);
    }
    out(`${counts.ok} ok, ${counts.mismatch} mismatched, ${counts.failed} failed`);
    if (counts.mismatch > 0 || counts.failed > 0) this.process.exitCode = 1;
  },
  parameters: {
    flags: {
      ...rendererFlags,
      manifest: manifestFlag,
      pdfs: pdfsFlag,
      out: {
        kind: "parsed",
        parse: String,
        brief: "Directory to write crops into",
        default: DEFAULT_CROPS_DIR
      },
      only: onlyFlag,
      jobs: {
        kind: "parsed",
        parse: numberParser,
        brief: "Number of crops rasterised concurrently",
        default: "4"
      },
      writeDigests: {
        kind: "boolean",
        brief:
          "Record the digests and sizes of the produced crops in the manifest instead of checking them",
        default: false
      }
    }
  },
  docs: {
    brief:
      "Rasterise every sample from the official exam PDFs and check the crops against the manifest."
  }
});

async function buildOne(
  flags: BuildFlags,
  renderer: Renderer,
  pdf: Buffer,
  { sample, stem }: Job
): Promise<Outcome> {
  const result = await crop(renderer, pdf, {
    page: sample.page,
    box: sample.box,
    masks: sample.masks
  });
  if (!result.ok) return { kind: "failed", message: result.message };

  const digest = sha256(result.png);
  const { width, height } = pngSize(result.png);
  await writeFile(join(flags.out, `${stem}.png`), result.png);

  if (flags.writeDigests) {
    sample.output = { width, height, sha256: digest };
    return { kind: "ok" };
  }
  const expected = sample.output;
  if (expected === undefined) {
    return {
      kind: "failed",
      message: "manifest has no output metadata for this sample; run with --write-digests"
    };
  }
  const mismatches: string[] = [];
  if (digest !== expected.sha256) {
    mismatches.push(`sha256 ${digest}, expected ${expected.sha256}`);
  }
  if (width !== expected.width || height !== expected.height) {
    mismatches.push(`size ${width}x${height}, expected ${expected.width}x${expected.height}`);
  }
  if (mismatches.length > 0) {
    return {
      kind: "mismatch",
      message: mismatches.join("; ")
    };
  }
  return { kind: "ok" };
}

interface FetchFlags {
  readonly manifest: string;
  readonly pdfs: string;
  readonly only?: string;
  readonly jobs: number;
  readonly force: boolean;
}

const fetchCommandDef = buildCommand({
  async func(this: LocalContext, flags: FetchFlags): Promise<void> {
    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    const out = (line: string) => this.process.stdout.write(`${line}\n`);

    const exams = selectExams(await readManifest(flags.manifest), flags.only);
    checkJobs(flags.jobs);
    await mkdir(flags.pdfs, { recursive: true });
    log(`${exams.length} exams into ${flags.pdfs}, ${flags.jobs} jobs`);

    const outcomes = new Map<string, Outcome>();
    await pMap(
      exams,
      async (exam) => {
        const id = examId(exam);
        let outcome: Outcome;
        try {
          outcome = await fetchOne(exam, flags);
        } catch (error) {
          outcome = {
            kind: "failed",
            message: `GET ${exam.url} failed: ${error instanceof Error ? error.message : String(error)}`
          };
        }
        outcomes.set(id, outcome);
        log(`${outcome.kind}: ${id}${outcome.message === undefined ? "" : `: ${outcome.message}`}`);
      },
      { concurrency: flags.jobs }
    );

    const counts = { ok: 0, mismatch: 0, failed: 0 };
    for (const id of [...outcomes.keys()].sort()) {
      const outcome = outcomes.get(id)!;
      counts[outcome.kind]++;
      if (outcome.kind !== "ok") out(`${outcome.kind}: ${id}: ${outcome.message}`);
    }
    out(`${counts.ok} ok, ${counts.mismatch} mismatched, ${counts.failed} failed`);
    if (counts.mismatch > 0 || counts.failed > 0) this.process.exitCode = 1;
  },
  parameters: {
    flags: {
      manifest: manifestFlag,
      pdfs: pdfsFlag,
      only: onlyFlag,
      jobs: {
        kind: "parsed",
        parse: numberParser,
        brief: "Number of PDFs downloaded concurrently",
        default: "4"
      },
      force: {
        kind: "boolean",
        brief: "Download every exam again, even if the local PDF already matches the manifest",
        default: false
      }
    }
  },
  docs: {
    brief: "Download the official exam PDFs listed in the manifest and check their digests."
  }
});

async function fetchOne(exam: Exam, flags: FetchFlags): Promise<Outcome> {
  const path = join(flags.pdfs, `${examId(exam)}.pdf`);
  if (!flags.force) {
    const existing = await readFile(path).catch(() => undefined);
    if (existing !== undefined && sha256(existing) === exam.sha256) {
      return { kind: "ok", message: "already downloaded" };
    }
  }

  const response = await fetch(exam.url);
  if (!response.ok) {
    return {
      kind: "failed",
      message: `GET ${exam.url} returned ${response.status} ${response.statusText}`
    };
  }
  const pdf = Buffer.from(await response.arrayBuffer());
  const digest = sha256(pdf);
  if (digest !== exam.sha256) {
    return {
      kind: "mismatch",
      message: `${exam.url} has sha256 ${digest}, manifest expects ${exam.sha256}; kept ${path} as it was`
    };
  }

  const partial = `${path}.part`;
  await writeFile(partial, pdf);
  await rename(partial, path);
  return { kind: "ok", message: `downloaded ${(pdf.length / 1e6).toFixed(1)} MB` };
}

async function readManifest(path: string): Promise<Exam[]> {
  return parseManifest(JSON.parse(await readFile(path, "utf8")));
}

function selectExams(manifest: readonly Exam[], only: string | undefined): Exam[] {
  const exams = only === undefined ? [...manifest] : manifest.filter((e) => examId(e) === only);
  if (exams.length === 0) {
    throw new Error(`no exam ${only} in manifest. Known exams: ${manifest.map(examId).join(", ")}`);
  }
  return exams;
}

function checkJobs(jobs: number): void {
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new Error("--jobs must be a positive integer");
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("latin1", 12, 16) !== "IHDR")
    throw new Error("crop is not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export const datasetRoutes = buildRouteMap({
  routes: { fetch: fetchCommandDef, build: buildCommandDef },
  docs: { brief: "Manage the benchmark dataset" }
});
