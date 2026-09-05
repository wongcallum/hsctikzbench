import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { parseManifest, sampleStem } from "hsctikzbench-cli/manifest";
import type { Plugin } from "vite";
import type { Judgement, JudgementItem, RunResult, RunSummary } from "../src/types.ts";

const API_PATH = "/api/runs";
const FILES_PREFIX = "/runs/";
const JUDGEMENT_FILE = "judgement.json";
const MAX_BODY = 1 << 20;

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8"
};

export interface RunsOptions {
  /** Directory holding one run directory per sample, named by sample stem. */
  runsDir: string;
  /** Path to the dataset manifest supplying per-sample checklists. */
  manifest: string;
}

/**
 * Serves a run listing at /api/runs, accepts judgements at PUT /api/runs/<name>/judgement, and
 * serves run files under /runs/<name>/...
 */
export function runsPlugin(options: RunsOptions): Plugin {
  const runsRoot = path.resolve(options.runsDir);
  const manifestPath = path.resolve(options.manifest);
  return {
    name: "hsctikzbench-runs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const judged = matchJudgement(url.pathname);
        if (url.pathname === API_PATH) {
          void handleList(runsRoot, manifestPath, res);
        } else if (judged !== null && req.method === "PUT") {
          void handleSave(runsRoot, judged, req, res);
        } else if (url.pathname.startsWith(FILES_PREFIX)) {
          void handleFile(runsRoot, url.pathname.slice(FILES_PREFIX.length), req, res);
        } else {
          next();
        }
      });
    }
  };
}

/** Extracts the run name from /api/runs/<name>/judgement, or null for any other path. */
function matchJudgement(pathname: string): string | null {
  const m = /^\/api\/runs\/([^/]+)\/judgement$/.exec(pathname);
  try {
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

async function handleList(runsRoot: string, manifestPath: string, res: ServerResponse) {
  try {
    const [runs, checklists] = await Promise.all([
      listRunDirs(runsRoot),
      readChecklists(manifestPath)
    ]);
    const summaries = await Promise.all(runs.map((dir) => summarize(dir, checklists)));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(summaries.sort(compareRuns)));
  } catch (e) {
    sendError(res, 500, e instanceof Error ? e.message : String(e));
  }
}

async function listRunDirs(runsRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(runsRoot, e.name));
}

/** Sample stem -> checklist (null when the sample has none). */
async function readChecklists(manifestPath: string): Promise<Map<string, string[] | null>> {
  const exams = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const map = new Map<string, string[] | null>();
  for (const exam of exams) {
    for (const sample of exam.samples) {
      map.set(sampleStem(exam, sample), sample.checklist ? [...sample.checklist] : null);
    }
  }
  return map;
}

async function summarize(
  dir: string,
  checklists: Map<string, string[] | null>
): Promise<RunSummary> {
  const name = path.basename(dir);
  const [result, hasReference, hasSubmission, renders, judgement] = await Promise.all([
    readJson<RunResult>(path.join(dir, "result.json")),
    exists(path.join(dir, "reference.png")),
    exists(path.join(dir, "submission.png")),
    listRenders(dir),
    readJson<Judgement>(path.join(dir, JUDGEMENT_FILE))
  ]);
  return {
    name,
    result,
    hasReference,
    hasSubmission,
    renders,
    knownSample: checklists.has(name),
    checklist: checklists.get(name) ?? null,
    judgement
  };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function listRenders(dir: string): Promise<string[]> {
  try {
    const names = await readdir(path.join(dir, "renders"));
    return names.filter((n) => n.endsWith(".png")).sort();
  } catch {
    return [];
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Newest first by startedAt; runs without a result sort first, then by name. */
function compareRuns(a: RunSummary, b: RunSummary): number {
  const ta = a.result?.startedAt ?? "";
  const tb = b.result?.startedAt ?? "";
  if (ta !== tb) return ta === "" ? -1 : tb === "" ? 1 : tb.localeCompare(ta);
  return a.name.localeCompare(b.name);
}

async function handleSave(
  runsRoot: string,
  name: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const dir = resolveRunDir(runsRoot, [name]);
  if (dir === null) {
    sendError(res, 400, "bad run name");
    return;
  }
  let judgement: Judgement;
  try {
    judgement = parseJudgement(JSON.parse(await readBody(req)));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : String(e));
    return;
  }
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error("not a directory");
  } catch {
    sendError(res, 404, "run not found");
    return;
  }
  try {
    await writeFile(path.join(dir, JUDGEMENT_FILE), `${JSON.stringify(judgement, null, 2)}\n`);
  } catch (e) {
    sendError(res, 500, e instanceof Error ? e.message : String(e));
    return;
  }
  res.statusCode = 204;
  res.end();
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

function parseJudgement(value: unknown): Judgement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("judgement: expected an object");
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!["items", "judgedAt"].includes(key)) throw new Error(`judgement.${key}: unexpected field`);
  }
  if (typeof r.judgedAt !== "string" || Number.isNaN(Date.parse(r.judgedAt))) {
    throw new Error("judgement.judgedAt: expected an ISO timestamp");
  }
  let items: JudgementItem[] | null = null;
  if (r.items !== null) {
    if (!Array.isArray(r.items)) throw new Error("judgement.items: expected an array or null");
    items = r.items.map((item, i) => parseItem(item, `judgement.items[${i}]`));
    if (new Set(items.map((i) => i.item)).size !== items.length) {
      throw new Error("judgement.items: items must be unique");
    }
  }
  return { items, judgedAt: r.judgedAt };
}

function parseItem(value: unknown, where: string): JudgementItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`);
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!["item", "pass"].includes(key)) throw new Error(`${where}.${key}: unexpected field`);
  }
  if (typeof r.item !== "string" || r.item.trim().length === 0) {
    throw new Error(`${where}.item: expected a non-empty string`);
  }
  if (r.pass !== null && typeof r.pass !== "boolean") {
    throw new Error(`${where}.pass: expected a boolean or null`);
  }
  return { item: r.item, pass: r.pass as boolean | null };
}

/** Joins path parts under the runs root, rejecting empty, dot, and escaping segments. */
function resolveRunDir(runsRoot: string, parts: string[]): string | null {
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("/"))) return null;
  const file = path.join(runsRoot, ...parts);
  if (!file.startsWith(runsRoot + path.sep)) return null;
  return file;
}

async function handleFile(
  runsRoot: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    sendError(res, 400, "bad path");
    return;
  }
  const parts = decoded.split("/");
  const file = parts.length < 2 ? null : resolveRunDir(runsRoot, parts);
  if (file === null) {
    sendError(res, 400, "bad path");
    return;
  }
  const type = CONTENT_TYPES[path.extname(file)];
  if (!type) {
    sendError(res, 404, "not found");
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    sendError(res, 404, "not found");
    return;
  }
  if (!info.isFile()) {
    sendError(res, 404, "not found");
    return;
  }
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", info.size);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) sendError(res, 500, "read failed");
    else res.destroy();
  });
  stream.pipe(res);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}
