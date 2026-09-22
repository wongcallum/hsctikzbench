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
  prior?: number;
  tolerance?: number;
  maxIterations?: number;
}

export function fitBradleyTerry(
  items: readonly string[],
  comparisons: readonly Comparison[],
  { prior = 1, tolerance = 1e-9, maxIterations = 10_000 }: FitOptions = {}
): Map<string, number> {
  const n = items.length;
  const index = new Map(items.map((item, i) => [item, i]));
  const wins = Array<number>(n).fill(prior / 2);
  const games = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const { a, b, outcome, weight } of comparisons) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    const share = outcome === "a" ? 1 : outcome === "b" ? 0 : 0.5;
    wins[i]! += weight * share;
    wins[j]! += weight * (1 - share);
    games[i]![j]! += weight;
    games[j]![i]! += weight;
  }

  let strength = Array<number>(n).fill(1);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const next = strength.map((s, i) => {
      const anchor = prior / (s + 1);
      const others = games[i]!.reduce((sum, g, j) => sum + g / (s + strength[j]!), 0);
      return wins[i]! / (anchor + others);
    });
    const change = Math.max(...next.map((s, i) => Math.abs(Math.log(s / strength[i]!))));
    strength = next;
    if (change < tolerance) break;
  }

  const logs = strength.map(Math.log);
  const mean = logs.reduce((sum, x) => sum + x, 0) / Math.max(n, 1);
  return new Map(items.map((item, i) => [item, logs[i]! - mean]));
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

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

export function bootstrapIntervals(
  items: readonly string[],
  comparisons: readonly Comparison[],
  { replicates = 1000, level = 0.95, seed = 0, relativeTo = null as string | null } = {},
  options: FitOptions = {}
): Map<string, Interval> {
  const groups = [...Map.groupBy(comparisons, (comparison) => comparison.group).values()];
  const random = mulberry32(seed);
  const fits = Array.from({ length: replicates }, () => {
    const resampled = groups.flatMap(() => groups[Math.floor(random() * groups.length)]!);
    return centre(fitBradleyTerry(items, resampled, options), relativeTo);
  });
  const tail = (1 - level) / 2;
  return new Map(
    items.map((item) => {
      const draws = fits.map((fit) => fit.get(item)!).sort((x, y) => x - y);
      const at = (q: number) =>
        draws[Math.min(draws.length - 1, Math.floor(q * draws.length))] ?? 0;
      return [item, { low: at(tail), high: at(1 - tail) }];
    })
  );
}

export function centre(
  scores: Map<string, number>,
  relativeTo: string | null
): Map<string, number> {
  const shift = relativeTo === null ? undefined : scores.get(relativeTo);
  if (shift === undefined) return scores;
  return new Map([...scores].map(([item, score]) => [item, score - shift]));
}

export const winProbability = (scoreA: number, scoreB: number) =>
  1 / (1 + Math.exp(scoreB - scoreA));
