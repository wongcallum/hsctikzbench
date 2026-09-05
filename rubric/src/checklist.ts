import type { SampleSummary } from "./types.ts";

export function toText(items: string[] | null): string {
  return items?.join("\n") ?? "";
}

export function fromText(text: string): string[] | null {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return items.length === 0 ? null : items;
}

export function isApproved(sample: SampleSummary): boolean {
  return sample.checklist !== null;
}

export function label(sample: SampleSummary): string {
  const kind = sample.option === null ? "figure" : `option ${sample.option}`;
  return `Q${sample.question} ${kind}`;
}
