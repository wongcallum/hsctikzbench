import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as z from "zod";
import { BATCH_NAME, type Assignments } from "../shared/types.ts";
import { config } from "./env.ts";
import { HttpError } from "./http.ts";
import { LOGIN, loginKey } from "./users.ts";

const AssignmentsSchema = z.record(z.string().regex(LOGIN), z.array(z.string().regex(BATCH_NAME)));

let cached: { mtimeMs: number; size: number; assignments: Assignments } | null = null;

/** Login (lower-cased) to the batches that login may judge. Re-read when the file changes. */
export async function loadAssignments(): Promise<Assignments> {
  let info;
  try {
    info = await stat(config.assignmentsFile);
  } catch {
    cached = null;
    return {};
  }
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.assignments;
  }
  let assignments: Assignments = {};
  try {
    assignments = normalize(
      AssignmentsSchema.parse(JSON.parse(await readFile(config.assignmentsFile, "utf8")))
    );
  } catch (e) {
    console.error(
      `ignoring ${config.assignmentsFile}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  cached = { mtimeMs: info.mtimeMs, size: info.size, assignments };
  return assignments;
}

function normalize(raw: Assignments): Assignments {
  const out: Assignments = {};
  for (const [login, batches] of Object.entries(raw)) {
    const key = loginKey(login);
    out[key] = [...new Set([...(out[key] ?? []), ...batches])].sort();
  }
  return out;
}

export async function saveAssignments(body: unknown): Promise<Assignments> {
  const parsed = AssignmentsSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new HttpError(400, `assignments: ${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const assignments = normalize(parsed.data);
  for (const login of Object.keys(assignments)) {
    if (assignments[login]!.length === 0) delete assignments[login];
  }
  await mkdir(path.dirname(config.assignmentsFile), { recursive: true });
  await writeFile(config.assignmentsFile, `${JSON.stringify(assignments, null, 2)}\n`);
  cached = null;
  return assignments;
}

/** Judges assigned to each batch, keyed by batch name. */
export function judgesByBatch(assignments: Assignments): Map<string, string[]> {
  const byBatch = new Map<string, string[]>();
  for (const [login, batches] of Object.entries(assignments)) {
    for (const batch of batches) {
      const judges = byBatch.get(batch);
      if (judges) judges.push(login);
      else byBatch.set(batch, [login]);
    }
  }
  for (const judges of byBatch.values()) judges.sort();
  return byBatch;
}
