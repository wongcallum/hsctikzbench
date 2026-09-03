import { execa } from "execa";

const EXIT_COMPILE = 2;
const EXIT_TIMEOUT = 3;
const EXIT_TOO_LARGE = 4;
const EXIT_RASTER = 5;

// slightly above the renderer's 60s timeout
const EXEC_TIMEOUT_MS = 90_000;

const LOG_TAIL_LINES = 20;
const MAX_ERROR_LINES = 40;

export type RenderResult = { ok: true; png: Buffer } | { ok: false; message: string };

export class RendererError extends Error {}

export async function checkContainer(container: string): Promise<void> {
  const { code, stdout, stderr } = await runDocker([
    "inspect",
    "-f",
    "{{.State.Running}}",
    container
  ]);
  if (code !== 0)
    throw new RendererError(`container ${container} not found: ${stderr.toString("utf8").trim()}`);
  if (stdout.toString("utf8").trim() !== "true")
    throw new RendererError(`container ${container} is not running`);
}

export async function render(container: string, source: string): Promise<RenderResult> {
  const { code, stdout, stderr } = await runDocker(["exec", "-i", container, "render"], source);
  const log = stderr.toString("utf8");
  switch (code) {
    case 0:
      return { ok: true, png: stdout };
    case EXIT_COMPILE:
      return { ok: false, message: extractLatexError(log) };
    case EXIT_TIMEOUT:
    case EXIT_TOO_LARGE:
      return { ok: false, message: rendererMessage(log) };
    case EXIT_RASTER:
      return { ok: false, message: `${rendererMessage(log)}\n${tail(log, LOG_TAIL_LINES)}` };
    default:
      throw new RendererError(`docker exec exited with ${code}: ${tail(log, LOG_TAIL_LINES)}`);
  }
}

// not verified by human yet.
export function extractLatexError(log: string): string {
  const lines = log.split("\n");
  const start = lines.findIndex((l) => l.startsWith("!"));
  if (start === -1) {
    return `${rendererMessage(log)}\n${tail(log, LOG_TAIL_LINES)}`;
  }
  const out: string[] = [];
  for (let i = start; i < lines.length && out.length < MAX_ERROR_LINES; i++) {
    const line = lines[i] ?? "";
    out.push(line);
    if (/^l\.\d+/.test(line)) {
      const next = lines[i + 1];
      if (next !== undefined) out.push(next);
      break;
    }
  }
  return out.join("\n").trimEnd();
}

function rendererMessage(log: string): string {
  const lines = log.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (line.startsWith("render: ")) return line.slice("render: ".length);
  }
  return "render failed";
}

function tail(text: string, n: number): string {
  return text.trimEnd().split("\n").slice(-n).join("\n");
}

interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

async function runDocker(args: string[], input?: string): Promise<ExecResult> {
  const result = await execa("docker", args, {
    encoding: "buffer",
    input,
    timeout: EXEC_TIMEOUT_MS,
    killSignal: "SIGKILL",
    reject: false
  });

  if (result.timedOut) {
    throw new RendererError(
      `docker ${args.join(" ")} did not exit within ${EXEC_TIMEOUT_MS / 1000}s`
    );
  }
  if (result.exitCode === undefined) {
    throw new RendererError(`failed to run docker: ${result.shortMessage}`);
  }

  return {
    code: result.exitCode,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr)
  };
}
