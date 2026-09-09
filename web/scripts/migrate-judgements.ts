// One-off: moves each run's judgement.json to judgements/<owner>.json, stamping the owner's
// login into it. Usage: tsx scripts/migrate-judgements.ts [owner-login]
// The login defaults to the owner named in the users file. Runs directory from RUNS_DIR.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { JudgementSchema } from "../shared/judge.ts";
import { config } from "../server/env.ts";
import { JUDGEMENTS_DIR, judgementFile } from "../server/judgements.ts";
import { loadUsers } from "../server/users.ts";

const LEGACY = "judgement.json";

async function ownerLogin(): Promise<string> {
  const argument = process.argv[2];
  if (argument) return argument;
  const owners = [...(await loadUsers())].filter(([, role]) => role === "owner");
  if (owners.length !== 1) {
    throw new Error(
      `${config.usersFile} names ${owners.length} owners; pass the login as an argument`
    );
  }
  return owners[0]![0];
}

async function dirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return [];
  }
}

const login = await ownerLogin();
let moved = 0;
for (const batch of await dirs(config.runsDir)) {
  for (const stem of await dirs(path.join(config.runsDir, batch))) {
    const runDir = path.join(config.runsDir, batch, stem);
    const legacy = path.join(runDir, LEGACY);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(legacy, "utf8"));
    } catch {
      continue;
    }
    const parsed = JudgementSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`skipping ${legacy}: ${parsed.error.issues[0]!.message}`);
      continue;
    }
    await mkdir(path.join(runDir, JUDGEMENTS_DIR), { recursive: true });
    const target = judgementFile(runDir, login);
    await writeFile(target, `${JSON.stringify({ ...parsed.data, judge: login }, null, 2)}\n`);
    await rename(legacy, `${legacy}.migrated`);
    moved++;
    console.log(`${batch}/${stem}: ${LEGACY} -> ${path.relative(runDir, target)}`);
  }
}
console.log(`${moved} judgement(s) migrated to ${login}`);
