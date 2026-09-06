import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  examId,
  parseManifest,
  sampleStem,
  type Exam,
  type Sample
} from "hsctikzbench-cli/manifest";
import { RESULT_FILE, type RunResult } from "hsctikzbench-cli/output";
import type { Plugin } from "vite";
import { hasSubmission } from "../src/sample.ts";
import { JudgementSchema, type Judgement, type Run, type SampleSummary } from "../src/types.ts";

const JUDGEMENT_FILE = "judgement.json";
const MAX_BODY = 1 << 20;
const RUN_FILE_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".tex": "text/plain; charset=utf-8"
};

export interface ApiOptions {
  /** Dataset manifest the samples are read from. */
  manifest: string;
  /** Directory holding <stem>.png for each sample. */
  cropsDir: string;
  /**
   * Directory holding one batch directory per bench invocation, each holding one run
   * directory per sample named by sample stem.
   */
  runsDir: string;
}

class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
  }
}

interface RunLocation {
  id: string;
  batch: string;
  stem: string;
  dir: string;
}

const runId = (batch: string, stem: string) =>
  createHash("sha256").update(`${batch}/${stem}`).digest("hex").slice(0, 12);

/**
 * Serves the sample listing at GET /api/samples (add ?blind to omit run provenance), accepts
 * judgements at PUT /api/runs/<id>/judgement, and serves files under /crops/ and /runs/<id>/.
 */
export function apiPlugin(options: ApiOptions): Plugin {
  const manifestPath = path.resolve(options.manifest);
  const cropsRoot = path.resolve(options.cropsDir);
  const runsRoot = path.resolve(options.runsDir);

  const readManifest = async (): Promise<Exam[]> =>
    parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));

  const listBatches = async (): Promise<string[]> => {
    const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  };

  const locateRun = async (id: string): Promise<RunLocation> => {
    const [exams, batches] = await Promise.all([readManifest(), listBatches()]);
    for (const batch of batches) {
      for (const exam of exams) {
        for (const sample of exam.samples) {
          const stem = sampleStem(exam, sample);
          if (runId(batch, stem) !== id) continue;
          const dir = path.join(runsRoot, batch, stem);
          if (!(await isDir(dir))) throw new HttpError(404, `no run ${id}`);
          return { id, batch, stem, dir };
        }
      }
    }
    throw new HttpError(404, `no run ${id}`);
  };

  const readRun = async (batch: string, stem: string, blind: boolean): Promise<Run | null> => {
    const dir = path.join(runsRoot, batch, stem);
    if (!(await isDir(dir))) return null;
    const [result, hasSubmission, renders, judgement] = await Promise.all([
      readJson<RunResult>(path.join(dir, RESULT_FILE)),
      isFile(path.join(dir, "submission.png")),
      readdir(path.join(dir, "renders")).then(
        (names) => names.filter((n) => n.endsWith(".png")).sort(),
        () => []
      ),
      readJson<unknown>(path.join(dir, JUDGEMENT_FILE))
    ]);
    const parsed = JudgementSchema.safeParse(judgement);
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
      judgement: parsed.success ? parsed.data : null,
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
  };

  const summarize = async (
    exam: Exam,
    sample: Sample,
    batches: string[],
    blind: boolean
  ): Promise<SampleSummary> => {
    const stem = sampleStem(exam, sample);
    const [hasCrop, found] = await Promise.all([
      isFile(path.join(cropsRoot, `${stem}.png`)),
      Promise.all(batches.map((batch) => readRun(batch, stem, blind)))
    ]);
    const runs = found.filter((run) => run !== null);
    // Batches are sorted by name; a blind listing orders by id so the position says nothing.
    if (blind) runs.sort((a, b) => a.id.localeCompare(b.id));
    return {
      stem,
      exam: examId(exam),
      question: sample.question,
      option: sample.option ?? null,
      role: sample.role,
      category: sample.category,
      hasCrop,
      runs
    };
  };

  return {
    name: "hsctikzbench-api",
    configureServer(server) {
      const list = async (blind: boolean): Promise<SampleSummary[]> => {
        const [exams, batches] = await Promise.all([readManifest(), listBatches()]);
        return Promise.all(
          exams.flatMap((exam) => exam.samples.map((s) => summarize(exam, s, batches, blind)))
        );
      };

      const saveJudgement = async (id: string, body: unknown): Promise<Judgement> => {
        const judgement = parseJudgement(body);
        const location = await locateRun(id);
        const run = await readRun(location.batch, location.stem, false);
        if (!run) throw new HttpError(404, `no run ${id}`);
        if (!run.result) throw new HttpError(409, "run has not finished");
        if (!hasSubmission(run))
          throw new HttpError(409, "no submission; already counted as a failure");
        if (!(await isFile(path.join(cropsRoot, `${location.stem}.png`)))) {
          throw new HttpError(409, "a reference crop is required to judge this submission");
        }
        await writeFile(
          path.join(location.dir, JUDGEMENT_FILE),
          `${JSON.stringify(judgement, null, 2)}\n`
        );
        return judgement;
      };

      const app = new Hono();
      app.use("/api/*", async (c, next) => {
        c.header("Cache-Control", "no-store");
        await next();
      });
      app.use(
        "/api/*",
        bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.text("body too large", 413) })
      );

      app.get("/api/samples", async (c) => c.json(await list(c.req.query("blind") !== undefined)));
      app.put("/api/runs/:id/judgement", async (c) =>
        c.json(await saveJudgement(c.req.param("id"), await jsonBody(c)))
      );

      const noCache = async (_file: string, c: Context) => c.header("Cache-Control", "no-store");
      app.on(
        ["GET", "HEAD"],
        "/crops/*",
        onlyExtensions([".png"]),
        serveStatic({
          root: cropsRoot,
          rewriteRequestPath: (requestPath) => requestPath.slice("/crops".length),
          onFound: noCache
        })
      );
      app.get("/runs/:id/*", async (c) => {
        const segments = c.req.path.split("/").slice(3).map(decodeSegment);
        if (segments.length === 0 || segments.some((s) => s === "" || s === "." || s === "..")) {
          return c.notFound();
        }
        const type = RUN_FILE_TYPES[path.extname(segments.at(-1)!)];
        if (!type) return c.notFound();
        const run = await locateRun(c.req.param("id"));
        let body: Buffer;
        try {
          body = await readFile(path.join(run.dir, ...segments));
        } catch {
          return c.notFound();
        }
        c.header("Content-Type", type);
        c.header("Cache-Control", "no-store");
        return c.body(new Uint8Array(body));
      });

      app.onError((error, c) =>
        c.text(errorMessage(error), error instanceof HttpError ? error.status : 500)
      );

      const listen = getRequestListener(app.fetch);
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!/^\/(?:api|crops|runs)(?:\/|$)/.test(pathname)) return next();
        void listen(req, res).catch(next);
      });
    }
  };
}

function parseJudgement(value: unknown): Judgement {
  const parsed = JudgementSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `judgement: ${parsed.error.issues[0]!.message}`);
  return parsed.data;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const isFile = (file: string) =>
  stat(file).then(
    (s) => s.isFile(),
    () => false
  );
const isDir = (file: string) =>
  stat(file).then(
    (s) => s.isDirectory(),
    () => false
  );

const onlyExtensions =
  (extensions: readonly string[]): MiddlewareHandler =>
  async (c, next) => {
    if (!extensions.includes(path.extname(c.req.path))) return c.notFound();
    await next();
  };

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch (e) {
    throw new HttpError(400, `invalid JSON: ${errorMessage(e)}`);
  }
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
