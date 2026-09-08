import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context, Message } from "@earendil-works/pi-ai";

export const REFERENCE_FILE = "reference.png";

export type RunStatus = "submitted" | "max_turns" | "error";

export interface RunResult {
  status: RunStatus;
  error?: string;
  provider: string;
  model: string;
  reasoning: string;
  turns: number;
  renders: number;
  successfulRenders: number;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
  durationMs: number;
  startedAt: string;
  harness?: HarnessInfo;
}

/** What the run was measured under; absent on runs from before renders were scaled. */
export interface HarnessInfo {
  renderer: string;
  fit: string;
  referenceSha256: string;
  promptSha256: string;
  maxTurns: number;
}

export interface Submission {
  source: string;
  png: Buffer;
}

export const RESULT_FILE = "result.json";

export class OutputDir {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async previousResult(): Promise<RunResult | undefined> {
    try {
      return JSON.parse(await readFile(join(this.dir, RESULT_FILE), "utf8")) as RunResult;
    } catch {
      return undefined;
    }
  }

  async prepare(referencePng: Buffer, { replace = false } = {}): Promise<void> {
    if (replace) await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    const existing = await readdir(this.dir);
    if (existing.length > 0) throw new Error(`output directory ${this.dir} is not empty`);
    await mkdir(join(this.dir, "renders"));
    await writeFile(join(this.dir, REFERENCE_FILE), referencePng);
  }

  async saveRender(n: number, png: Buffer): Promise<string> {
    const name = `renders/${String(n).padStart(2, "0")}.png`;
    await writeFile(join(this.dir, name), png);
    return name;
  }

  /** imageNames are in the order the images entered the context: reference, then renders. */
  async finish(
    result: RunResult,
    context: Context,
    imageNames: readonly string[],
    submission?: Submission
  ): Promise<void> {
    if (submission) {
      await writeFile(join(this.dir, "submission.tex"), submission.source);
      await writeFile(join(this.dir, "submission.png"), submission.png);
    }
    let next = 0;
    const transcript = {
      ...context,
      messages: context.messages.map((m) =>
        stripImages(m, () => imageNames[next++] ?? "<unsaved image>")
      )
    };
    await writeFile(join(this.dir, "transcript.json"), JSON.stringify(transcript, null, 2));
    await writeFile(join(this.dir, RESULT_FILE), JSON.stringify(result, null, 2));
  }
}

// Names come from the order images entered the context, not their bytes: a model that
// renders the same source twice produces byte-identical PNGs.
function stripImages(message: Message, nextName: () => string): Message {
  if (message.role === "assistant" || typeof message.content === "string") return message;
  const content = message.content.map((part) =>
    part.type === "image" ? { ...part, data: nextName() } : part
  );
  return { ...message, content } as Message;
}
