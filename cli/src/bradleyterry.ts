/**
 * Bradley-Terry over pairwise comparisons: each item has a strength, and the odds that one
 * beats another are the ratio of their strengths. Fitted by Hunter's MM iteration.
 */

export interface Comparison {
  readonly a: string;
  readonly b: string;
  readonly outcome: "a" | "b" | "tie";
  /** How many observations this stands for. A tie is half a win each way. */
  readonly weight: number;
  /** Comparisons sharing a group are resampled together by the bootstrap. */
  readonly group: string;
}

export interface FitOptions {
  /** Weight of the pseudo tie between each item and a fixed anchor, which keeps an item that
   * never loses finite. */
  prior?: number;
  tolerance?: number;
  maxIterations?: number;
}

/** Log strengths, centred so their mean is zero. Items without comparisons sit at the prior. */
export function fitBradleyTerry(
  items: readonly string[],
  comparisons: readonly Comparison[],
  { prior = 1, tolerance = 1e-9, maxIterations = 10_000 }: FitOptions = {}
): Map<string, number> {
  const index = new Map(items.map((item, i) => [item, i]));
  const n = items.length;
  const wins = new Float64Array(n).fill(prior / 2);
  const between = new Map<number, number>();
  const at = (i: number, j: number) => i * n + j;
  for (const { a, b, outcome, weight } of comparisons) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    const key = at(Math.min(i, j), Math.max(i, j));
    between.set(key, (between.get(key) ?? 0) + weight);
    if (outcome === "a") wins[i] = wins[i]! + weight;
    else if (outcome === "b") wins[j] = wins[j]! + weight;
    else {
      wins[i] = wins[i]! + weight / 2;
      wins[j] = wins[j]! + weight / 2;
    }
  }
  const pairs = [...between].map(([key, count]) => ({
    i: Math.floor(key / n),
    j: key % n,
    count
  }));

  let strength = new Float64Array(n).fill(1);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const denominator = new Float64Array(n);
    for (let i = 0; i < n; i++) denominator[i] = prior / (strength[i]! + 1);
    for (const { i, j, count } of pairs) {
      const shared = count / (strength[i]! + strength[j]!);
      denominator[i] = denominator[i]! + shared;
      denominator[j] = denominator[j]! + shared;
    }
    const next = new Float64Array(n);
    let change = 0;
    for (let i = 0; i < n; i++) {
      next[i] = wins[i]! / denominator[i]!;
      change = Math.max(change, Math.abs(Math.log(next[i]! / strength[i]!)));
    }
    strength = next;
    if (change < tolerance) break;
  }

  const logs = [...strength].map(Math.log);
  const mean = logs.reduce((sum, x) => sum + x, 0) / Math.max(n, 1);
  return new Map(items.map((item, i) => [item, logs[i]! - mean]));
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

/** Small, fast, seedable; only used to resample. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile intervals for the scores by resampling groups with replacement. Comparisons on
 * the same sample are correlated, so the sample is the unit resampled. Scores are centred
 * on `relativeTo` when given, so the interval is of the difference from it.
 */
export function bootstrapIntervals(
  items: readonly string[],
  comparisons: readonly Comparison[],
  { replicates = 1000, level = 0.95, seed = 0, relativeTo = null as string | null } = {},
  options: FitOptions = {}
): Map<string, Interval> {
  const byGroup = new Map<string, Comparison[]>();
  for (const comparison of comparisons) {
    const group = byGroup.get(comparison.group);
    if (group) group.push(comparison);
    else byGroup.set(comparison.group, [comparison]);
  }
  const groups = [...byGroup.values()];
  const random = mulberry32(seed);
  const draws = new Map(items.map((item) => [item, [] as number[]]));
  for (let r = 0; r < replicates; r++) {
    const resampled: Comparison[] = [];
    for (let g = 0; g < groups.length; g++) {
      resampled.push(...groups[Math.floor(random() * groups.length)]!);
    }
    const scores = centre(fitBradleyTerry(items, resampled, options), relativeTo);
    for (const item of items) draws.get(item)!.push(scores.get(item)!);
  }
  const tail = (1 - level) / 2;
  return new Map(
    items.map((item) => {
      const sorted = draws.get(item)!.sort((x, y) => x - y);
      const pick = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      return [item, { low: pick(tail), high: pick(1 - tail) }];
    })
  );
}

/** Scores shifted so `relativeTo` sits at zero; unchanged when it is null. */
export function centre(
  scores: Map<string, number>,
  relativeTo: string | null
): Map<string, number> {
  if (relativeTo === null) return scores;
  const shift = scores.get(relativeTo);
  if (shift === undefined) return scores;
  return new Map([...scores].map(([item, score]) => [item, score - shift]));
}

/** Fitted chance that `a` beats `b`, ties aside. */
export const winProbability = (scoreA: number, scoreB: number) =>
  1 / (1 + Math.exp(scoreB - scoreA));
