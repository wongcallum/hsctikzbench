import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommand, buildRouteMap, numberParser } from "@stricli/core";
import pMap from "p-map";
import type { LocalContext } from "../context.ts";
import { examId, parseManifest, sampleStem, serializeManifest, type Sample } from "../manifest.ts";
import { crop } from "../render.ts";
import { createRenderer, rendererFlags, type Renderer, type RendererFlags } from "../renderer.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DATASET_DIR = join(REPO_ROOT, "dataset");
const DATA_DIR = join(REPO_ROOT, "data");

interface BuildFlags extends RendererFlags {
  readonly manifest: string;
  readonly pdfs: string;
  readonly out: string;
  readonly only?: string;
  readonly jobs: number;
  readonly writeDigests: boolean;
}

type Outcome =
  | { kind: "ok" }
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

    const manifest = parseManifest(JSON.parse(await readFile(flags.manifest, "utf8")));
    const exams =
      flags.only === undefined ? manifest : manifest.filter((e) => examId(e) === flags.only);
    if (exams.length === 0) {
      throw new Error(
        `no exam ${flags.only} in manifest. Known exams: ${manifest.map(examId).join(", ")}`
      );
    }
    if (!Number.isInteger(flags.jobs) || flags.jobs < 1) {
      throw new Error("--jobs must be a positive integer");
    }

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
        const message = `missing PDF ${pdfPath} (${err instanceof Error ? err.message : String(err)})`;
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
      manifest: {
        kind: "parsed",
        parse: String,
        brief: "Path to the dataset manifest",
        default: join(DATASET_DIR, "manifest.json")
      },
      pdfs: {
        kind: "parsed",
        parse: String,
        brief: "Directory holding <year>-<course>.pdf for each exam",
        default: join(DATA_DIR, "pdfs")
      },
      out: {
        kind: "parsed",
        parse: String,
        brief: "Directory to write crops into",
        default: join(DATA_DIR, "crops")
      },
      only: {
        kind: "parsed",
        parse: String,
        brief: "Build a single exam, given as <year>-<course>",
        optional: true
      },
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

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("latin1", 12, 16) !== "IHDR")
    throw new Error("crop is not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export const datasetRoutes = buildRouteMap({
  routes: { build: buildCommandDef },
  docs: { brief: "Manage the benchmark dataset" }
});
