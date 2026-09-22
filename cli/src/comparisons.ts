import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";

/**
 * Pairwise comparisons live under `comparisons/<stem>/`, apart from the runs they compare:
 *
 *   pairs.json      every pair drawn for the sample, in draw order, never reordered
 *   <login>.jsonl   one line per outcome the judge recorded, in judging order
 *
 * Both name runs by batch, since the sample is the directory. A pair is stored with its
 * batches in name order, so it has one spelling; an outcome is relative to that order.
 */

export const PAIRS_FILE = "pairs.json";
export const OUTCOMES = ["a", "b", "tie"] as const;

const batch = z.string().min(1);

export const PairSchema = z.strictObject({ a: batch, b: batch });
export const PairsFileSchema = z.array(PairSchema);
export const StoredOutcomeSchema = z.strictObject({
  a: batch,
  b: batch,
  outcome: z.enum(OUTCOMES),
  judgedAt: z.iso.datetime()
});

export type Pair = z.infer<typeof PairSchema>;
export type Outcome = (typeof OUTCOMES)[number];
export type StoredOutcome = z.infer<typeof StoredOutcomeSchema>;

export const orderPair = (x: string, y: string): Pair => (x < y ? { a: x, b: y } : { a: y, b: x });

/** Batch names have no newline, so this cannot collide. */
export const pairKey = (pair: Pair) => `${pair.a}\n${pair.b}`;

export const sampleDir = (comparisonsDir: string, stem: string) => join(comparisonsDir, stem);
export const pairsFile = (dir: string) => join(dir, PAIRS_FILE);
export const outcomesFile = (dir: string, login: string) => join(dir, `${login}.jsonl`);

const isMissing = (e: unknown) => (e as { code?: string }).code === "ENOENT";

/** A corrupt file throws rather than reading as empty: reading it as empty would draw the
 * pairs again and overwrite it. */
export async function readPairs(dir: string): Promise<Pair[]> {
  let text: string;
  try {
    text = await readFile(pairsFile(dir), "utf8");
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
  const parsed = PairsFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${pairsFile(dir)}: ${parsed.error.issues[0]!.message}`);
  return parsed.data;
}

export async function readJudgeOutcomes(dir: string, login: string): Promise<StoredOutcome[]> {
  const file = outcomesFile(dir, login);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
  return parseOutcomes(file, text);
}

/** All recorded outcomes, including separate votes from different judges on the same pair. */
export async function readOutcomes(dir: string): Promise<StoredOutcome[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
  const logins = names.filter((n) => n.endsWith(".jsonl")).map((n) => n.slice(0, -6));
  return (await Promise.all(logins.map((login) => readJudgeOutcomes(dir, login)))).flat();
}

export function parseOutcomes(file: string, text: string): StoredOutcome[] {
  const outcomes: StoredOutcome[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${i + 1}: not JSON`);
    }
    const parsed = StoredOutcomeSchema.safeParse(json);
    if (!parsed.success) throw new Error(`${file}:${i + 1}: ${parsed.error.issues[0]!.message}`);
    outcomes.push(parsed.data);
  }
  return outcomes;
}

export const serializeOutcome = (outcome: StoredOutcome) => `${JSON.stringify(outcome)}\n`;
export const serializePairs = (pairs: readonly Pair[]) => `${JSON.stringify(pairs, null, 2)}\n`;
