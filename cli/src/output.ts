import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
}

export interface Submission {
  source: string;
  png: Buffer;
}

export const RESULT_FILE = "result.json";

export class OutputDir {
  constructor(readonly dir: string) {}

  async isComplete(): Promise<boolean> {
    try {
      await access(join(this.dir, RESULT_FILE));
      return true;
    } catch {
      return false;
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

  async finish(
    result: RunResult,
    context: Context,
    imageNames: Map<string, string>,
    submission?: Submission
  ): Promise<void> {
    if (submission) {
      await writeFile(join(this.dir, "submission.tex"), submission.source);
      await writeFile(join(this.dir, "submission.png"), submission.png);
    }
    const transcript = {
      ...context,
      messages: context.messages.map((m) => stripImages(m, imageNames))
    };
    await writeFile(join(this.dir, "transcript.json"), JSON.stringify(transcript, null, 2));
    await writeFile(join(this.dir, RESULT_FILE), JSON.stringify(result, null, 2));
  }
}

function stripImages(message: Message, imageNames: Map<string, string>): Message {
  if (message.role === "assistant" || typeof message.content === "string") return message;
  const content = message.content.map((part) =>
    part.type === "image" ? { ...part, data: imageNames.get(part.data) ?? "<unsaved image>" } : part
  );
  return { ...message, content } as Message;
}
