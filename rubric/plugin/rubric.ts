import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  examId,
  parseManifest,
  sampleStem,
  serializeManifest,
  type Exam,
  type Sample
} from "hsctikzbench-cli/manifest";
import { REASONING_LEVELS, resolveModel, type ReasoningLevel } from "hsctikzbench-cli/model";
import type { Plugin } from "vite";
import type { SampleSummary } from "../src/types.ts";

const API_PATH = "/api/samples";
const CROPS_PREFIX = "/crops/";
const MAX_BODY = 1 << 20;

export interface RubricOptions {
  /** Path to the dataset manifest that checklists are read from and written to. */
  manifest: string;
  /** Directory holding <stem>.png for each sample. */
  cropsDir: string;
  /** Path to the drafting prompt. */
  prompt: string;
  model: {
    provider: string;
    model: string;
    reasoning: string;
    auth: string;
  };
}

type Drafter = (sample: Sample, png: Buffer) => Promise<string[]>;

/**
 * Serves a sample listing at /api/samples, accepts checklists at PUT /api/samples/<stem>/checklist,
 * drafts one at POST /api/samples/<stem>/draft, and serves crops under /crops/<stem>.png.
 */
export function rubricPlugin(options: RubricOptions): Plugin {
  const manifestPath = path.resolve(options.manifest);
  const cropsRoot = path.resolve(options.cropsDir);
  return {
    name: "hsctikzbench-rubric",
    async configureServer(server) {
      const draft = await createDrafter(options);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const action = matchAction(url.pathname);
        if (url.pathname === API_PATH) {
          void handleList(manifestPath, cropsRoot, res);
        } else if (action?.action === "checklist" && req.method === "PUT") {
          void handleSave(manifestPath, action.stem, req, res);
        } else if (action?.action === "draft" && req.method === "POST") {
          void handleDraft(manifestPath, cropsRoot, draft, action.stem, res);
        } else if (url.pathname.startsWith(CROPS_PREFIX)) {
          void handleCrop(cropsRoot, url.pathname.slice(CROPS_PREFIX.length), res);
        } else {
          next();
        }
      });
    }
  };
}

async function createDrafter(options: RubricOptions): Promise<Drafter> {
  const reasoning = options.model.reasoning;
  if (!(REASONING_LEVELS as readonly string[]).includes(reasoning)) {
    throw new Error(
      `rubric: REASONING must be one of ${REASONING_LEVELS.join(", ")}, got ${reasoning}`
    );
  }
  const level = reasoning as ReasoningLevel;
  const { models, model, authSource } = await resolveModel({
    provider: options.model.provider,
    model: options.model.model,
    reasoning: level,
    auth: options.model.auth
  });
  const systemPrompt = await readFile(options.prompt, "utf8");
  // eslint-disable-next-line no-console
  console.log(`rubric: drafting with ${model.provider}/${model.id} (auth: ${authSource})`);

  return async (sample, png) => {
    const reply = await models.completeSimple(
      model,
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
      level === "off" ? {} : { reasoning: level }
    );
    if (reply.stopReason === "error") {
      throw new Error(reply.errorMessage ?? "provider returned an error");
    }
    const text = reply.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseItems(text);
  };
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

/** Extracts a JSON array of strings from a model reply, tolerating a code fence around it. */
function parseItems(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`model reply contained no JSON array:\n${text}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(
      `model reply was not valid JSON (${e instanceof Error ? e.message : e}):\n${text}`
    );
  }
  return parseChecklist(value);
}

function parseChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("checklist: expected an array");
  const items = value.map((item, i) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`checklist[${i}]: expected a non-empty string`);
    }
    return item.trim();
  });
  if (new Set(items).size !== items.length) throw new Error("checklist: items must be unique");
  return items;
}

/** Matches /api/samples/<stem>/<action>, or null for any other path. */
function matchAction(pathname: string): { stem: string; action: "checklist" | "draft" } | null {
  const m = /^\/api\/samples\/([^/]+)\/(checklist|draft)$/.exec(pathname);
  if (!m) return null;
  try {
    return { stem: decodeURIComponent(m[1]!), action: m[2] as "checklist" | "draft" };
  } catch {
    return null;
  }
}

async function readManifest(manifestPath: string): Promise<Exam[]> {
  return parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

async function handleList(manifestPath: string, cropsRoot: string, res: ServerResponse) {
  try {
    const exams = await readManifest(manifestPath);
    const summaries: SampleSummary[] = [];
    for (const exam of exams) {
      for (const sample of exam.samples) {
        const stem = sampleStem(exam, sample);
        summaries.push({
          stem,
          exam: examId(exam),
          question: sample.question,
          option: sample.option ?? null,
          role: sample.role,
          category: sample.category,
          checklist: sample.checklist ? [...sample.checklist] : null,
          hasCrop: await exists(cropPath(cropsRoot, stem))
        });
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(summaries));
  } catch (e) {
    sendError(res, 500, e instanceof Error ? e.message : String(e));
  }
}

async function handleDraft(
  manifestPath: string,
  cropsRoot: string,
  draft: Drafter,
  stem: string,
  res: ServerResponse
) {
  try {
    const found = findSample(await readManifest(manifestPath), stem);
    if (!found) {
      sendError(res, 404, `no sample ${stem} in manifest`);
      return;
    }
    const file = cropPath(cropsRoot, stem);
    if (file === null || !(await exists(file))) {
      sendError(res, 404, `no crop for ${stem}; run dataset build`);
      return;
    }
    const items = await draft(found.sample, await readFile(file));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(items));
  } catch (e) {
    sendError(res, 500, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Re-reads the manifest, replaces one sample's checklist (null removes it), validates the
 * result the same way the CLI does, and writes it back. The file is untouched on any failure.
 */
async function handleSave(
  manifestPath: string,
  stem: string,
  req: IncomingMessage,
  res: ServerResponse
) {
  let checklist: string[] | null;
  try {
    const body: unknown = JSON.parse(await readBody(req));
    checklist = body === null ? null : parseChecklist(body);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : String(e));
    return;
  }
  try {
    const exams = await readManifest(manifestPath);
    const found = findSample(exams, stem);
    if (!found) {
      sendError(res, 404, `no sample ${stem} in manifest`);
      return;
    }
    const updated = exams.map((exam) =>
      exam !== found.exam
        ? exam
        : {
            ...exam,
            samples: exam.samples.map((s) =>
              s !== found.sample ? s : withChecklist(s, checklist ?? undefined)
            )
          }
    );
    const serialized = serializeManifest(updated);
    parseManifest(JSON.parse(serialized));
    await writeFile(manifestPath, serialized);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(checklist));
  } catch (e) {
    sendError(res, 500, e instanceof Error ? e.message : String(e));
  }
}

/** Rebuilds the sample with keys in the manifest's canonical order. */
function withChecklist(s: Sample, checklist: readonly string[] | undefined): Sample {
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

function findSample(exams: Exam[], stem: string): { exam: Exam; sample: Sample } | null {
  for (const exam of exams) {
    for (const sample of exam.samples) {
      if (sampleStem(exam, sample) === stem) return { exam, sample };
    }
  }
  return null;
}

function cropPath(cropsRoot: string, stem: string): string | null {
  if (stem === "" || stem === "." || stem === ".." || stem.includes("/")) return null;
  const file = path.join(cropsRoot, `${stem}.png`);
  return file.startsWith(cropsRoot + path.sep) ? file : null;
}

async function handleCrop(cropsRoot: string, rest: string, res: ServerResponse) {
  let stem: string;
  try {
    stem = decodeURIComponent(rest).replace(/\.png$/, "");
  } catch {
    sendError(res, 400, "bad path");
    return;
  }
  const file = cropPath(cropsRoot, stem);
  if (file === null || !(await exists(file))) {
    sendError(res, 404, "not found");
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  createReadStream(file)
    .on("error", () => sendError(res, 500, "read failed"))
    .pipe(res);
}

async function exists(file: string | null): Promise<boolean> {
  if (file === null) return false;
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendError(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}
