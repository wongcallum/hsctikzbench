import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import type { RunResult, RunSummary } from "../src/types.ts";

const API_PATH = "/api/runs";
const FILES_PREFIX = "/runs/";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8"
};

/** Serves a run listing at /api/runs and run files under /runs/<name>/... */
export function runsPlugin(root: string): Plugin {
  const runsRoot = path.resolve(root);
  return {
    name: "hsctikzbench-runs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === API_PATH) {
          void handleList(runsRoot, res);
        } else if (url.pathname.startsWith(FILES_PREFIX)) {
          void handleFile(runsRoot, url.pathname.slice(FILES_PREFIX.length), req, res);
        } else {
          next();
        }
      });
    }
  };
}

async function handleList(runsRoot: string, res: ServerResponse): Promise<void> {
  try {
    const runs = await listRuns(runsRoot);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(runs));
  } catch (e) {
    sendError(res, 500, e instanceof Error ? e.message : String(e));
  }
}

async function listRuns(runsRoot: string): Promise<RunSummary[]> {
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const runs = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => summarize(path.join(runsRoot, e.name)))
  );
  return runs.sort(compareRuns);
}

async function summarize(dir: string): Promise<RunSummary> {
  const [result, hasReference, hasSubmission, renders] = await Promise.all([
    readResult(dir),
    exists(path.join(dir, "reference.png")),
    exists(path.join(dir, "submission.png")),
    listRenders(dir)
  ]);
  return { name: path.basename(dir), result, hasReference, hasSubmission, renders };
}

async function readResult(dir: string): Promise<RunResult | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")) as RunResult;
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
  if (parts.length < 2 || parts.some((p) => p === "" || p === "." || p === "..")) {
    sendError(res, 400, "bad path");
    return;
  }
  const file = path.join(runsRoot, ...parts);
  if (!file.startsWith(runsRoot + path.sep)) {
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
