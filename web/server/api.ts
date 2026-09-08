import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import * as z from "zod";
import { BATCH_NAME, type LaunchParams } from "../shared/types.ts";
import { batchDetail, listBatches } from "./batches.ts";
import { config, repoProblems } from "./env.ts";
import { HttpError, jsonBody } from "./http.ts";
import type { JobManager } from "./jobs.ts";
import { listSamples, locateRun, saveJudgement } from "./judge.ts";
import { collectInfo, loadManifest } from "./repo.ts";

const RENDERERS = ["auto", "local", "podman", "docker", "nerdctl"] as const;
const MAX_BODY = 1 << 20;
const FILE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8"
};
const STEM = /^[A-Za-z0-9._-]+$/;

const LaunchSchema = z.strictObject({
  batch: z.string().regex(BATCH_NAME, "use letters, digits, dots, dashes and underscores"),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
  maxTurns: z.number().int().min(1).max(500),
  jobs: z.number().int().min(1).max(64),
  resume: z.boolean(),
  renderer: z.enum(RENDERERS),
  exams: z.array(z.string()),
  samples: z.array(z.string())
});

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function createApi(jobs: JobManager): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "/api/*",
    bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.text("body too large", 413) })
  );

  app.get("/api/info", async (c) => c.json(await collectInfo()));

  app.get("/api/jobs", (c) => c.json(jobs.list()));

  app.post("/api/jobs", async (c) => {
    const problems = repoProblems();
    if (problems.length > 0) throw new HttpError(503, problems.join("; "));
    const parsed = LaunchSchema.safeParse(await jsonBody(c));
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new HttpError(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
    }
    const params: LaunchParams = parsed.data;
    const manifest = await loadManifest();
    const examIds = new Set(manifest.exams.map((e) => e.id));
    for (const exam of params.exams) {
      if (!examIds.has(exam)) throw new HttpError(400, `unknown exam ${exam}`);
    }
    const inExams = (stem: string) =>
      params.exams.length === 0 || params.exams.includes(manifest.stems.get(stem) ?? "");
    let stems = [...manifest.stems.keys()].filter(inExams);
    if (params.samples.length > 0) {
      const chosen = new Set(params.samples);
      for (const stem of chosen) {
        if (!manifest.stems.has(stem)) throw new HttpError(400, `unknown sample ${stem}`);
        if (!inExams(stem)) throw new HttpError(400, `sample ${stem} is not in the chosen exams`);
      }
      stems = stems.filter((s) => chosen.has(s));
    }
    if (stems.length === 0) throw new HttpError(400, "no samples selected");

    const outDir = path.join(config.runsDir, params.batch);
    const active = jobs.running().find((job) => job.outDir === outDir);
    if (active) throw new HttpError(409, `job ${active.id} is already writing to ${params.batch}`);
    if (!params.resume && (await listDir(outDir)).length > 0) {
      throw new HttpError(
        409,
        `batch ${params.batch} already has output; choose another name or enable resume`
      );
    }
    const job = await jobs.launch(params, stems);
    return c.json(job, 201);
  });

  app.get("/api/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job) throw new HttpError(404, "no such job");
    return c.json({ job, progress: jobs.progress(job.id) });
  });

  app.get("/api/jobs/:id/log", (c) => {
    const lines = jobs.lines(c.req.param("id"), Number(c.req.query("after") ?? 0));
    if (!lines) throw new HttpError(404, "no such job");
    return c.json(lines);
  });

  app.post("/api/jobs/:id/cancel", (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job) throw new HttpError(404, "no such job");
    if (!jobs.cancel(job.id)) throw new HttpError(409, "job is not running");
    return c.json(jobs.get(job.id));
  });

  app.get("/api/jobs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!jobs.get(id)) throw new HttpError(404, "no such job");
    const after = Number(c.req.query("after") ?? 0);
    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: string[] = [];
      let flushing: Promise<void> | null = null;
      const flush = async () => {
        while (queue.length > 0 && !closed) {
          const data = queue.shift()!;
          try {
            await stream.writeSSE({ data });
          } catch {
            closed = true;
          }
        }
        flushing = null;
      };
      const unsubscribe = jobs.subscribe(id, after, (event) => {
        queue.push(JSON.stringify(event));
        flushing ??= flush();
      });
      const keepalive = setInterval(() => {
        queue.push(JSON.stringify({ type: "ping" }));
        flushing ??= flush();
      }, 20_000);
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          closed = true;
          resolve();
        });
      });
      clearInterval(keepalive);
      unsubscribe?.();
    });
  });

  app.get("/api/batches", async (c) => c.json(await listBatches(jobs)));

  app.get("/api/batches/:name", async (c) => {
    const name = c.req.param("name");
    if (!BATCH_NAME.test(name)) throw new HttpError(400, "bad batch name");
    const detail = await batchDetail(name, jobs, await loadManifest());
    if (!detail) throw new HttpError(404, "no such batch");
    return c.json(detail);
  });

  // Judging: runs addressed by id, so a blind listing never reveals the batch.
  app.get("/api/samples", async (c) =>
    c.json(await listSamples(c.req.query("blind") !== undefined))
  );

  app.put("/api/runs/:id/judgement", async (c) =>
    c.json(await saveJudgement(c.req.param("id"), await jsonBody(c)))
  );

  app.get("/files/crops/:file", async (c) => {
    const file = c.req.param("file");
    if (!/^[A-Za-z0-9._-]+\.png$/.test(file)) return c.notFound();
    return sendFile(c, path.join(config.cropsDir, file));
  });

  app.get("/files/runs/:batch/:stem/*", async (c) => {
    const batch = c.req.param("batch");
    const stem = c.req.param("stem");
    const rest = pathSegments(c.req.path, 5);
    if (!BATCH_NAME.test(batch) || !STEM.test(stem) || !rest) return c.notFound();
    return sendFile(c, path.join(config.runsDir, batch, stem, ...rest));
  });

  app.get("/runs/:id/*", async (c) => {
    const rest = pathSegments(c.req.path, 3);
    if (!rest) return c.notFound();
    const run = await locateRun(c.req.param("id"));
    return sendFile(c, path.join(run.dir, ...rest));
  });

  app.onError((error, c) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    return c.text(error.message, status);
  });

  return app;
}

function pathSegments(requestPath: string, skip: number): string[] | null {
  const segments = requestPath.split("/").slice(skip).map(decodeSegment);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function sendFile(c: Context, file: string): Promise<Response> {
  const type = FILE_TYPES[path.extname(file)];
  if (!type) return c.notFound();
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return c.notFound();
  }
  c.header("Content-Type", type);
  c.header("Cache-Control", "no-store");
  return c.body(new Uint8Array(body));
}
