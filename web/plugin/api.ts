import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
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

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8"
};

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
  readonly status: number;
  constructor(status: number, message: string) {
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
        const dir = safePath(runsRoot, [stem]);
        if (!(await isDir(dir))) throw new HttpError(404, `no run for ${stem}`);
        await writeFile(path.join(dir, JUDGEMENT_FILE), `${JSON.stringify(judgement, null, 2)}\n`);
        return judgement;
      };

      const route = (req: IncomingMessage, res: ServerResponse): Promise<void> | null => {
        const method = req.method ?? "GET";
        const [head, ...rest] = decodePath(req.url ?? "/");
        if (head === "crops") return serveFile(cropsRoot, rest, req, res);
        if (head === "runs") return serveFile(runsRoot, rest, req, res);
        if (head !== "api" || rest[0] !== "samples") return null;
        if (rest.length === 1 && method === "GET") return list().then((v) => sendJson(res, v));
        const [, stem, action] = rest;
        if (rest.length !== 3 || !stem) return null;
        if (action === "checklist" && method === "PUT") {
          return readJsonBody(req)
            .then((b) => saveChecklist(stem, b))
            .then((v) => sendJson(res, v));
        }
        if (action === "draft" && method === "POST") {
          return draftChecklist(stem).then((v) => sendJson(res, v));
        }
        if (action === "judgement" && method === "PUT") {
          return readJsonBody(req)
            .then((b) => saveJudgement(stem, b))
            .then((v) => sendJson(res, v));
        }
        return null;
      };

      server.middlewares.use((req, res, next) => {
        const handled = route(req, res);
        if (!handled) return next();
        handled.catch((e: unknown) => {
          sendError(res, e instanceof HttpError ? e.status : 500, errorMessage(e));
        });
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

function decodePath(url: string): string[] {
  const { pathname } = new URL(url, "http://localhost");
  try {
    return pathname.split("/").slice(1).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, "bad path");
  }
}

function safePath(root: string, parts: string[]): string {
  const bad = (p: string) => p === "" || p === "." || p === ".." || /[/\\]/.test(p);
  if (parts.length === 0 || parts.some(bad)) throw new HttpError(400, "bad path");
  const file = path.join(root, ...parts);
  if (!file.startsWith(root + path.sep)) throw new HttpError(400, "bad path");
  return file;
}

async function serveFile(
  root: string,
  parts: string[],
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const file = safePath(root, parts);
  const type = CONTENT_TYPES[path.extname(file)];
  const info = await stat(file).catch(() => null);
  if (!type || !info?.isFile()) throw new HttpError(404, "not found");
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", info.size);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file)
    .on("error", () => sendError(res, 500, "read failed"))
    .pipe(res);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const text = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new HttpError(400, `invalid JSON: ${errorMessage(e)}`);
  }
}

function sendJson(res: ServerResponse, value: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
