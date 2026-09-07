import type { Box } from "./manifest.ts";
import { RendererError, type Renderer } from "./renderer.ts";

const EXIT_COMPILE = 2;
const EXIT_TIMEOUT = 3;
const EXIT_TOO_LARGE = 4;
const EXIT_RASTER = 5;
const EXIT_SPEC = 6;

const LOG_TAIL_LINES = 20;
const MAX_ERROR_LINES = 40;

export type RenderResult = { ok: true; png: Buffer } | { ok: false; message: string };

export async function render(renderer: Renderer, source: string): Promise<RenderResult> {
  const { code, stdout, stderr } = await renderer.exec(["render"], source);
  const log = stderr.toString("utf8");
  switch (code) {
    case 0:
      return { ok: true, png: stdout };
    case EXIT_COMPILE:
      return { ok: false, message: extractLatexError(log) };
    case EXIT_TIMEOUT:
    case EXIT_TOO_LARGE:
      return { ok: false, message: rendererMessage(log, "render") };
    case EXIT_RASTER:
      return {
        ok: false,
        message: `${rendererMessage(log, "render")}\n${tail(log, LOG_TAIL_LINES)}`
      };
    default:
      throw new RendererError(`renderer exited with ${code}: ${tail(log, LOG_TAIL_LINES)}`);
  }
}

export interface CropSpec {
  readonly page: number;
  readonly box: Box;
  readonly masks?: readonly Box[];
}

export async function crop(renderer: Renderer, pdf: Buffer, spec: CropSpec): Promise<RenderResult> {
  const rectArg = (r: Box) => [r.x, r.y, r.w, r.h].join(",");
  const args = ["crop", "--page", String(spec.page), "--box", rectArg(spec.box)];

  for (const mask of spec.masks ?? []) args.push("--mask", rectArg(mask));
  const { code, stdout, stderr } = await renderer.exec(args, pdf);
  const log = stderr.toString("utf8");

  switch (code) {
    case 0:
      return { ok: true, png: stdout };
    case EXIT_TIMEOUT:
    case EXIT_SPEC:
      return { ok: false, message: rendererMessage(log, "crop") };
    case EXIT_RASTER:
      return {
        ok: false,
        message: `${rendererMessage(log, "crop")}\n${tail(log, LOG_TAIL_LINES)}`
      };
    default:
      throw new RendererError(`renderer exited with ${code}: ${tail(log, LOG_TAIL_LINES)}`);
  }
}

// not verified by human yet.
export function extractLatexError(log: string): string {
  const lines = log.split("\n");
  const start = lines.findIndex((l) => l.startsWith("!"));
  if (start === -1) {
    return `${rendererMessage(log, "render")}\n${tail(log, LOG_TAIL_LINES)}`;
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

function rendererMessage(log: string, command: string): string {
  const prefix = `${command}: `;
  const lines = log.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return `${command} failed`;
}

function tail(text: string, n: number): string {
  return text.trimEnd().split("\n").slice(-n).join("\n");
}
