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

export interface ApiOptions {
  /** Dataset manifest the samples are read from. */
  manifest: string;
  /** Directory holding <stem>.png for each sample. */
  cropsDir: string;
  /** Directory holding one run directory per sample, named by sample stem. */
  runsDir: string;
}

class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Serves the sample listing at GET /api/samples, accepts judgements at
 * PUT /api/samples/<stem>/judgement, and serves files under /crops/ and /runs/.
 */
export function apiPlugin(options: ApiOptions): Plugin {
  const manifestPath = path.resolve(options.manifest);
  const cropsRoot = path.resolve(options.cropsDir);
  const runsRoot = path.resolve(options.runsDir);

  const readManifest = async (): Promise<Exam[]> =>
    parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));

  const requireSample = async (stem: string): Promise<void> => {
    const exams = await readManifest();
    const known = exams.some((exam) => exam.samples.some((s) => sampleStem(exam, s) === stem));
    if (!known) throw new HttpError(404, `no sample ${stem} in manifest`);
  };

  const summarize = async (exam: Exam, sample: Sample): Promise<SampleSummary> => {
    const stem = sampleStem(exam, sample);
    const [hasCrop, run] = await Promise.all([
      isFile(path.join(cropsRoot, `${stem}.png`)),
      readRun(path.join(runsRoot, stem))
    ]);
    return {
      stem,
      exam: examId(exam),
      question: sample.question,
      option: sample.option ?? null,
      role: sample.role,
      category: sample.category,
      hasCrop,
      run
    };
  };

  return {
    name: "hsctikzbench-api",
    configureServer(server) {
      const list = async (): Promise<SampleSummary[]> => {
        const exams = await readManifest();
        return Promise.all(exams.flatMap((exam) => exam.samples.map((s) => summarize(exam, s))));
      };

      const saveJudgement = async (stem: string, body: unknown): Promise<Judgement> => {
        const judgement = parseJudgement(body);
        await requireSample(stem);
        const dir = path.join(runsRoot, stem);
        const run = await readRun(dir);
        if (!run) throw new HttpError(404, `no run for ${stem}`);
        if (!run.result) throw new HttpError(409, "run has not finished");
        if (!hasSubmission(run))
          throw new HttpError(409, "no submission; already counted as a failure");
        if (!(await isFile(path.join(cropsRoot, `${stem}.png`)))) {
          throw new HttpError(409, "a reference crop is required to judge this submission");
        }
        await writeFile(path.join(dir, JUDGEMENT_FILE), `${JSON.stringify(judgement, null, 2)}\n`);
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

      app.get("/api/samples", async (c) => c.json(await list()));
      app.put("/api/samples/:stem/judgement", async (c) =>
        c.json(await saveJudgement(c.req.param("stem"), await jsonBody(c)))
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
      app.on(
        ["GET", "HEAD"],
        "/runs/*",
        onlyExtensions([".json", ".png", ".tex"]),
        serveStatic({
          root: runsRoot,
          rewriteRequestPath: (requestPath) => requestPath.slice("/runs".length),
          onFound: noCache
        })
      );

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

async function readRun(dir: string): Promise<Run | null> {
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
  return { result, hasSubmission, renders, judgement: parsed.success ? parsed.data : null };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
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
