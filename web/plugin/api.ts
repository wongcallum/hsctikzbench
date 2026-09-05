import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  examId,
  ChecklistSchema,
  parseManifest,
  sampleStem,
  serializeManifest,
  type Exam,
  type Sample
} from "hsctikzbench-cli/manifest";
import { REASONING_LEVELS, resolveModel, type ReasoningLevel } from "hsctikzbench-cli/model";
import { RESULT_FILE, type RunResult } from "hsctikzbench-cli/output";
import type { Plugin } from "vite";
import {
  JudgementSchema,
  type Judgement,
  type Listing,
  type Run,
  type SampleSummary
} from "../src/types.ts";

const JUDGEMENT_FILE = "judgement.json";
const MAX_BODY = 1 << 20;

export interface ApiOptions {
  /** Dataset manifest that checklists are read from and written to. */
  manifest: string;
  /** Directory holding <stem>.png for each sample. */
  cropsDir: string;
  /** Directory holding one run directory per sample, named by sample stem. */
  runsDir: string;
  /** Drafting prompt. */
  prompt: string;
  /** Model used to draft checklists, or null to disable drafting. */
  model: { provider: string; model: string; reasoning: string; auth: string } | null;
}

type Drafter = (sample: Sample, png: Buffer) => Promise<string[]>;

class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Serves the sample listing at GET /api/samples, accepts writes at
 * PUT /api/samples/<stem>/checklist, POST /api/samples/<stem>/draft and
 * PUT /api/samples/<stem>/judgement, and serves files under /crops/ and /runs/.
 */
export function apiPlugin(options: ApiOptions): Plugin {
  const manifestPath = path.resolve(options.manifest);
  const cropsRoot = path.resolve(options.cropsDir);
  const runsRoot = path.resolve(options.runsDir);

  const readManifest = async (): Promise<Exam[]> =>
    parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));

  const findSample = async (stem: string) => {
    const exams = await readManifest();
    for (const exam of exams) {
      for (const sample of exam.samples) {
        if (sampleStem(exam, sample) === stem) return { exams, exam, sample };
      }
    }
    throw new HttpError(404, `no sample ${stem} in manifest`);
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
      checklist: sample.checklist ? [...sample.checklist] : null,
      hasCrop,
      run
    };
  };

  return {
    name: "hsctikzbench-api",
    async configureServer(server) {
      const draft = options.model && (await createDrafter(options.model, options.prompt));

      const list = async (): Promise<Listing> => {
        const exams = await readManifest();
        const samples = exams.flatMap((exam) => exam.samples.map((s) => summarize(exam, s)));
        return { canDraft: draft !== null, samples: await Promise.all(samples) };
      };

      const saveChecklist = async (stem: string, body: unknown): Promise<string[] | null> => {
        const checklist = body === null ? null : parseChecklist(body);
        const { exams, exam, sample } = await findSample(stem);
        const updated = exams.map((e) =>
          e !== exam
            ? e
            : {
                ...e,
                samples: e.samples.map((s) =>
                  s !== sample ? s : withChecklist(s, checklist ?? undefined)
                )
              }
        );
        // Validate the same way the CLI does; the file is untouched on failure.
        const serialized = serializeManifest(updated);
        parseManifest(JSON.parse(serialized));
        await writeFile(manifestPath, serialized);
        return checklist;
      };

      const draftChecklist = async (stem: string): Promise<string[]> => {
        if (!draft) throw new HttpError(501, "drafting is disabled; set PROVIDER and MODEL");
        const { sample } = await findSample(stem);
        const png = await readFile(path.join(cropsRoot, `${stem}.png`)).catch(() => {
          throw new HttpError(404, `no crop for ${stem}; run dataset build`);
        });
        return draft(sample, png);
      };

      const saveJudgement = async (stem: string, body: unknown): Promise<Judgement> => {
        const judgement = parseJudgement(body);
        await findSample(stem);
        const dir = path.join(runsRoot, stem);
        if (!(await isDir(dir))) throw new HttpError(404, `no run for ${stem}`);
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
      app.put("/api/samples/:stem/checklist", async (c) =>
        c.json(await saveChecklist(c.req.param("stem"), await jsonBody(c)))
      );
      app.post("/api/samples/:stem/draft", async (c) =>
        c.json(await draftChecklist(c.req.param("stem")))
      );
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

async function createDrafter(model: NonNullable<ApiOptions["model"]>, promptPath: string) {
  if (!(REASONING_LEVELS as readonly string[]).includes(model.reasoning)) {
    throw new Error(`web: REASONING must be one of ${REASONING_LEVELS.join(", ")}`);
  }
  const reasoning = model.reasoning as ReasoningLevel;
  const resolved = await resolveModel({ ...model, reasoning });
  const systemPrompt = await readFile(promptPath, "utf8");
  console.log(`web: drafting with ${model.provider}/${model.model} (auth: ${resolved.authSource})`);

  const drafter: Drafter = async (sample, png) => {
    const reply = await resolved.models.completeSimple(
      resolved.model,
      {
        systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: describe(sample) },
              { type: "image", data: png.toString("base64"), mimeType: "image/png" }
            ],
            timestamp: Date.now()
          }
        ]
      },
      reasoning === "off" ? {} : { reasoning }
    );
    if (reply.stopReason === "error") {
      throw new Error(reply.errorMessage ?? "provider returned an error");
    }
    const text = reply.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseReply(text);
  };
  return drafter;
}

function describe(sample: Sample): string {
  const role =
    sample.role === "answer_option"
      ? `one of the answer options (option ${sample.option}) of a multiple-choice question`
      : sample.role === "response_template"
        ? "a template the student is expected to draw on"
        : "a figure accompanying a question";
  return `Category: ${sample.category.replaceAll("_", " ")}. This is ${role}.`;
}

function parseReply(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end < start) {
    throw new Error(`model reply contained no JSON array:\n${text}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`model reply was not valid JSON (${errorMessage(e)}):\n${text}`);
  }
  return parseChecklist(value);
}

function parseChecklist(value: unknown): string[] {
  const parsed = ChecklistSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `checklist: ${parsed.error.issues[0]!.message}`);
  return parsed.data;
}

function parseJudgement(value: unknown): Judgement {
  const parsed = JudgementSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `judgement: ${parsed.error.issues[0]!.message}`);
  return parsed.data;
}

function withChecklist(s: Sample, checklist: string[] | undefined): Sample {
  return {
    question: s.question,
    option: s.option,
    role: s.role,
    index: s.index,
    page: s.page,
    box: s.box,
    masks: s.masks,
    category: s.category,
    checklist,
    output: s.output
  };
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
    readJson<Judgement>(path.join(dir, JUDGEMENT_FILE))
  ]);
  return { result, hasSubmission, renders, judgement };
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
