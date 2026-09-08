import type { Box } from "./manifest.ts";
import { RendererError, type ExecResult, type Renderer } from "./renderer.ts";

const EXIT_COMPILE = 2;
const EXIT_TIMEOUT = 3;
const EXIT_TOO_LARGE = 4;
const EXIT_RASTER = 5;
const EXIT_SPEC = 6;

const LOG_TAIL_LINES = 20;
const MAX_ERROR_LINES = 40;

export type RenderResult = { ok: true; png: Buffer } | { ok: false; message: string };

export interface PngSize {
  readonly width: number;
  readonly height: number;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

/** Reads the dimensions out of a PNG's IHDR, which is always its first chunk. */
export function pngSize(png: Buffer): PngSize {
  if (png.length < IHDR_HEIGHT_OFFSET + 4 || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new RendererError("expected a PNG");
  }
  return {
    width: png.readUInt32BE(IHDR_WIDTH_OFFSET),
    height: png.readUInt32BE(IHDR_HEIGHT_OFFSET)
  };
}

// gs rounds the raster up to whole pixels, so a fitted render may exceed the box by one.
const FIT_TOLERANCE_PX = 2;

// Renders are only ever scaled down, so anything above the box means --fit did not take.
function checkFitted(png: Buffer, fit: PngSize): void {
  const size = pngSize(png);
  if (size.width <= fit.width + FIT_TOLERANCE_PX && size.height <= fit.height + FIT_TOLERANCE_PX) {
    return;
  }
  throw new RendererError(
    `renderer returned a ${size.width}x${size.height} render for --fit ${fit.width}x${fit.height}, ` +
      "so it predates --fit and ignored it. Update the renderer: `nix build .#image` for a " +
      "container backend, or `nix profile upgrade renderer` for --renderer local."
  );
}

export async function render(
  renderer: Renderer,
  source: string,
  fit?: PngSize
): Promise<RenderResult> {
  const args = ["render"];
  if (fit) args.push("--fit", `${fit.width}x${fit.height}`);
  const response = await renderer.exec(args, source);
  if (response.code === 0) {
    if (fit) checkFitted(response.stdout, fit);
    return { ok: true, png: response.stdout };
  }
  return interpretFailure(response, {
    [EXIT_COMPILE]: extractLatexError,
    [EXIT_TIMEOUT]: (log) => rendererMessage(log, "render"),
    [EXIT_TOO_LARGE]: (log) => rendererMessage(log, "render"),
    [EXIT_RASTER]: (log) => rasterError(log, "render")
  });
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
  const response = await renderer.exec(args, pdf);
  if (response.code === 0) return { ok: true, png: response.stdout };
  return interpretFailure(response, {
    [EXIT_TIMEOUT]: (log) => rendererMessage(log, "crop"),
    [EXIT_SPEC]: (log) => rendererMessage(log, "crop"),
    [EXIT_RASTER]: (log) => rasterError(log, "crop")
  });
}

function interpretFailure(
  response: Pick<ExecResult, "code" | "stderr">,
  handlers: Partial<Record<number, (log: string) => string>>
): RenderResult {
  const log = response.stderr.toString("utf8");
  const message = handlers[response.code]?.(log);
  if (message !== undefined) return { ok: false, message };
  throw new RendererError(`renderer exited with ${response.code}: ${tail(log, LOG_TAIL_LINES)}`);
}

function rasterError(log: string, command: string): string {
  return `${rendererMessage(log, command)}\n${tail(log, LOG_TAIL_LINES)}`;
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
