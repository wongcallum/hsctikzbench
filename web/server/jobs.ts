import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProgressEvent } from "hsctikzbench-cli/progress";
import type {
  Job,
  JobProgress,
  LaunchParams,
  LogLine,
  LogStream,
  SampleProgress,
  SseEvent
} from "../shared/types.ts";
import { config } from "./env.ts";

const CANCEL_GRACE_MS = 15_000;
const SHUTDOWN_GRACE_MS = 10_000;

interface Record_ {
  job: Job;
  lines: LogLine[];
  progress: JobProgress;
  events: EventEmitter<{ event: [SseEvent] }>;
  child: ChildProcess | null;
  log: WriteStream | null;
  cancelRequested: boolean;
}

export class JobManager {
  private readonly records = new Map<string, Record_>();
  private readonly dir = path.join(config.stateDir, "jobs");

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jobDir = path.join(this.dir, entry.name);
      let job: Job;
      try {
        job = JSON.parse(await readFile(path.join(jobDir, "job.json"), "utf8")) as Job;
      } catch {
        continue;
      }
      const lines = await readLog(path.join(jobDir, "log.jsonl"));
      const record: Record_ = {
        job,
        lines,
        progress: replay(lines, job.stems),
        events: new EventEmitter(),
        child: null,
        log: null,
        cancelRequested: false
      };
      this.records.set(job.id, record);
      if (job.status === "running") {
        job.status = "interrupted";
        job.error = "the runner server stopped while the job was running";
        job.finishedAt ??= new Date().toISOString();
        job.pid = null;
        await this.save(record);
      }
    }
  }

  list(): Job[] {
    return [...this.records.values()]
      .map((r) => r.job)
      .sort((a, b) => cmp(b.createdAt, a.createdAt));
  }

  get(id: string): Job | undefined {
    return this.records.get(id)?.job;
  }

  progress(id: string): JobProgress | undefined {
    return this.records.get(id)?.progress;
  }

  lines(id: string, after = 0): LogLine[] | undefined {
    return this.records.get(id)?.lines.slice(after);
  }

  forOutDir(outDir: string): Job | undefined {
    return this.list().find((job) => job.outDir === outDir);
  }

  running(): Job[] {
    return this.list().filter((job) => job.status === "running");
  }

  subscribe(id: string, after: number, send: (event: SseEvent) => void): (() => void) | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    for (const line of record.lines.slice(after)) send({ type: "line", line });
    send({ type: "progress", progress: record.progress });
    send({ type: "status", job: record.job });
    record.events.on("event", send);
    return () => record.events.off("event", send);
  }

  async launch(params: LaunchParams, stems: string[]): Promise<Job> {
    const outDir = path.join(config.runsDir, params.batch);
    const id = newId();
    const { command, cwd } = buildCommand(params, outDir);
    const job: Job = {
      id,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      status: "running",
      exitCode: null,
      error: null,
      params,
      command,
      cwd,
      outDir,
      stems,
      pid: null
    };
    const jobDir = path.join(this.dir, id);
    await mkdir(jobDir, { recursive: true });
    await mkdir(config.runsDir, { recursive: true });
    const record: Record_ = {
      job,
      lines: [],
      progress: replay([], stems),
      events: new EventEmitter(),
      child: null,
      log: createWriteStream(path.join(jobDir, "log.jsonl"), { flags: "a" }),
      cancelRequested: false
    };
    this.records.set(id, record);
    this.append(record, "sys", `launching in ${cwd}: ${command.map(shellQuote).join(" ")}`);

    let child: ChildProcess;
    try {
      // fd 3 carries the bench's progress events; see --progress-fd.
      child = spawn(command[0]!, command.slice(1), {
        cwd,
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
      });
    } catch (e) {
      await this.finish(record, null, `failed to spawn: ${message(e)}`);
      return job;
    }
    record.child = child;
    job.pid = child.pid ?? null;
    job.startedAt = new Date().toISOString();
    await this.save(record);
    this.emitStatus(record);

    pipeLines(child.stdout, (text) => this.append(record, "out", text));
    pipeLines(child.stderr, (text) => this.append(record, "err", text));
    pipeLines(child.stdio[3] as NodeJS.ReadableStream | null, (text) =>
      this.append(record, "progress", text)
    );
    child.on("error", (e) => {
      this.append(record, "sys", `process error: ${e.message}`);
      void this.finish(record, null, e.message);
    });
    child.on("close", (code, signal) => {
      const how = signal ? `killed by ${signal}` : `exited with code ${code}`;
      this.append(record, "sys", how);
      void this.finish(record, code, signal ? how : null);
    });
    return job;
  }

  cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record?.child || record.job.status !== "running") return false;
    record.cancelRequested = true;
    this.append(record, "sys", "cancel requested; sending SIGINT");
    record.child.kill("SIGINT");
    const child = record.child;
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        this.append(record, "sys", "still running; sending SIGKILL");
        child.kill("SIGKILL");
      }
    }, CANCEL_GRACE_MS).unref();
    return true;
  }

  async shutdown(): Promise<void> {
    const running = [...this.records.values()].filter((r) => r.child && r.job.status === "running");
    for (const record of running) {
      this.append(record, "sys", "runner shutting down; sending SIGINT");
      record.cancelRequested = true;
      record.child!.kill("SIGINT");
    }
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    await Promise.all(
      running.map(
        (record) =>
          new Promise<void>((resolve) => {
            const child = record.child!;
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            child.once("close", () => resolve());
            setTimeout(
              () => {
                child.kill("SIGKILL");
                resolve();
              },
              Math.max(0, deadline - Date.now())
            ).unref();
          })
      )
    );
    for (const record of running) {
      if (record.job.status === "running") {
        record.job.status = "interrupted";
        record.job.error = "the runner server was stopped";
        record.job.finishedAt = new Date().toISOString();
        await this.save(record);
      }
    }
  }

  private append(record: Record_, stream: LogStream, text: string): void {
    const line: LogLine = { n: record.lines.length, t: Date.now(), stream, text };
    record.lines.push(line);
    record.log?.write(`${JSON.stringify(line)}\n`);
    const changed = applyLine(record.progress, line);
    record.events.emit("event", { type: "line", line });
    if (changed) record.events.emit("event", { type: "progress", progress: record.progress });
  }

  private async finish(record: Record_, code: number | null, error: string | null): Promise<void> {
    const { job } = record;
    if (job.status !== "running") return;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    job.pid = null;
    if (record.cancelRequested) job.status = "cancelled";
    else if (code === 0) job.status = "succeeded";
    else job.status = "failed";
    if (error) job.error = error;
    else if (job.status === "failed") job.error = `bench exited with code ${code}`;
    record.child = null;
    record.log?.end();
    record.log = null;
    await this.save(record);
    this.emitStatus(record);
  }

  private emitStatus(record: Record_): void {
    record.events.emit("event", { type: "status", job: record.job });
  }

  private save(record: Record_): Promise<void> {
    return writeFile(
      path.join(this.dir, record.job.id, "job.json"),
      `${JSON.stringify(record.job, null, 2)}\n`
    );
  }
}

function buildCommand(params: LaunchParams, outDir: string): { command: string[]; cwd: string } {
  const args = [
    "bench",
    "--provider",
    params.provider,
    "--model",
    params.model,
    "--reasoning",
    params.reasoning,
    "--max-turns",
    String(params.maxTurns),
    "--jobs",
    String(params.jobs),
    "--renderer",
    params.renderer,
    "--out",
    outDir,
    "--progress-fd",
    "3"
  ];
  for (const exam of params.exams) args.push("--exam", exam);
  for (const sample of params.samples) args.push("--sample", sample);
  if (params.resume) args.push("--resume");
  if (config.benchCommand) {
    // An override is given relative to this package, so it runs from here.
    const override = config.benchCommand.split(/\s+/).filter((s) => s !== "");
    return { command: [...override, ...args], cwd: config.root };
  }
  return {
    // The tsx bin re-execs node as a child and only forwards stdio 0-2, so fd 3 would reach
    // the bench as tsx's IPC channel instead of the progress pipe. Load tsx in-process.
    command: [process.execPath, "--import", "tsx", "src/cli.ts", ...args],
    cwd: config.cliDir
  };
}

function pipeLines(stream: NodeJS.ReadableStream | null, onLine: (text: string) => void): void {
  if (!stream) return;
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    rest += chunk;
    let i: number;
    while ((i = rest.indexOf("\n")) !== -1) {
      onLine(rest.slice(0, i).replace(/\r$/, ""));
      rest = rest.slice(i + 1);
    }
  });
  stream.on("end", () => {
    if (rest !== "") onLine(rest);
  });
}

async function readLog(file: string): Promise<LogLine[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const lines: LogLine[] = [];
  for (const raw of text.split("\n")) {
    if (raw === "") continue;
    try {
      lines.push(JSON.parse(raw) as LogLine);
    } catch {
      // a partial trailing line from a crash
    }
  }
  return lines;
}

const emptyProgress = (): SampleProgress => ({
  turn: null,
  maxTurns: null,
  cost: null,
  lastLine: null,
  lastAt: null,
  outcome: null,
  done: null
});

function replay(lines: readonly LogLine[], stems: readonly string[]): JobProgress {
  const progress: JobProgress = { source: "log", done: 0, total: stems.length, samples: {} };
  for (const stem of stems) progress.samples[stem] = emptyProgress();
  for (const line of lines) applyLine(progress, line);
  return progress;
}

const STEM_LINE = /^\[([^\]]+)\] (.*)$/;
const TURN = /^turn (\d+)\/(\d+)/;
const COST = /cost=\$([\d.]+)/;
const OUTCOME = /^(submitted|max_turns|error|skipped|failed)\b(.*?)\s+\((\d+)\/(\d+)\)$/;

// Progress events are authoritative once seen; the log lines are only a fallback until then.
function applyLine(progress: JobProgress, line: LogLine): boolean {
  if (line.stream === "progress") return applyEvent(progress, line);
  if (line.stream !== "err" || progress.source === "events") return false;
  const match = STEM_LINE.exec(line.text);
  if (!match) return false;
  const [, stem, rest] = match as unknown as [string, string, string];
  const sample = (progress.samples[stem] ??= emptyProgress());
  sample.lastLine = rest;
  sample.lastAt = line.t;
  const turn = TURN.exec(rest);
  if (turn) {
    sample.turn = Number(turn[1]);
    sample.maxTurns = Number(turn[2]);
  }
  const cost = COST.exec(rest);
  if (cost) sample.cost = Number(cost[1]);
  const outcome = OUTCOME.exec(rest);
  if (outcome) {
    sample.outcome = outcome[1]!;
    sample.done = Number(outcome[3]);
    progress.done = Math.max(progress.done, sample.done);
    progress.total = Number(outcome[4]);
  }
  return true;
}

function applyEvent(progress: JobProgress, line: LogLine): boolean {
  let event: ProgressEvent;
  try {
    event = JSON.parse(line.text) as ProgressEvent;
  } catch {
    return false;
  }
  progress.source = "events";
  switch (event.type) {
    case "start": {
      progress.total = event.stems.length;
      for (const stem of event.stems) {
        const sample = (progress.samples[stem] ??= emptyProgress());
        sample.maxTurns = event.maxTurns;
      }
      return true;
    }
    case "turn": {
      const sample = (progress.samples[event.stem] ??= emptyProgress());
      sample.turn = event.turn;
      sample.maxTurns = event.maxTurns;
      sample.cost = event.cost;
      sample.lastLine = `turn ${event.turn}/${event.maxTurns}  ${event.note}`;
      sample.lastAt = line.t;
      return true;
    }
    case "done": {
      const sample = (progress.samples[event.stem] ??= emptyProgress());
      sample.outcome = event.outcome;
      sample.done = event.done;
      if (event.cost !== null) sample.cost = event.cost;
      if (event.turns !== null) sample.turn = event.turns;
      sample.lastLine = event.message ? `${event.outcome}: ${event.message}` : event.outcome;
      sample.lastAt = line.t;
      progress.done = Math.max(progress.done, event.done);
      progress.total = event.total;
      return true;
    }
    default:
      return false;
  }
}

function newId(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const shellQuote = (s: string) =>
  /^[\w./:=@%+-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
