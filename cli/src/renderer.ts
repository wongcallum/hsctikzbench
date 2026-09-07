import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execa } from "execa";

// slightly above the renderer's 60s timeout
const EXEC_TIMEOUT_MS = 90_000;

export const DEFAULT_IMAGE = "ghcr.io/wongcallum/hsctikzbench-renderer:0.1.0";
export const DEFAULT_RENDER_BIN = "render";
export const CONTAINER_RUNTIMES = ["podman", "docker", "nerdctl"] as const;

export class RendererError extends Error {}

export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface Renderer {
  readonly description: string;
  /** Makes the backend usable, e.g. by fetching a missing image. Called once per command. */
  prepare(): Promise<void>;
  exec(args: string[], input?: string | Buffer): Promise<ExecResult>;
}

class LocalRenderer implements Renderer {
  constructor(private readonly bin: string) {}

  get description(): string {
    return `local ${this.bin}`;
  }

  async prepare(): Promise<void> {
    if ((await resolveBin(this.bin)) === undefined) {
      throw new RendererError(
        `no renderer binary ${this.bin} on PATH. Install it with \`nix profile install .#renderer\`, ` +
          `or set HSCTIKZBENCH_RENDER_BIN to its path.`
      );
    }
  }

  exec(args: string[], input?: string | Buffer): Promise<ExecResult> {
    return runProcess(this.bin, args, input);
  }
}

const SANDBOX_ARGS = [
  "--network",
  "none",
  "--read-only",
  "--tmpfs",
  "/tmp:rw,mode=1777,size=1g",
  "--pids-limit",
  "512"
];

export const PULL_POLICIES = ["missing", "never", "always"] as const;
export type PullPolicy = (typeof PULL_POLICIES)[number];

const activeContainers = new Set<() => Promise<void>>();
let shuttingDown = false;

function handleShutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // Keep the signal handlers installed while cleanup runs, including on repeated Ctrl+C.
  void Promise.allSettled([...activeContainers].map((cleanup) => cleanup())).then(() => {
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

const handleSigint = () => handleShutdown("SIGINT");
const handleSigterm = () => handleShutdown("SIGTERM");

function trackContainer(cleanup: () => Promise<void>): () => void {
  if (activeContainers.size === 0) {
    process.on("SIGINT", handleSigint);
    process.on("SIGTERM", handleSigterm);
  }
  activeContainers.add(cleanup);
  return () => {
    activeContainers.delete(cleanup);
    if (activeContainers.size === 0 && !shuttingDown) {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
    }
  };
}

class ContainerRenderer implements Renderer {
  constructor(
    private readonly runtime: string,
    private readonly image: string,
    private readonly pullPolicy: PullPolicy
  ) {}

  get description(): string {
    return `${this.runtime} ${this.image}`;
  }

  async prepare(): Promise<void> {
    if ((await resolveBin(this.runtime)) === undefined) {
      throw new RendererError(
        `${this.runtime} is not on PATH. Install it, or name another backend with --renderer.`
      );
    }
    if (this.pullPolicy === "always") return this.pull();

    const inspect = await runProcess(this.runtime, ["image", "inspect", this.image]);
    if (inspect.code === 0) return;

    const stderr = inspect.stderr.toString("utf8").trim();
    if (!isMissingImage(stderr)) {
      throw new RendererError(
        `${this.runtime} could not look up ${this.image}:\n${stderr}${runtimeHint(this.runtime, stderr)}`
      );
    }
    if (this.pullPolicy === "never" || !isRegistryRef(this.image)) {
      throw new RendererError(this.missingImageMessage());
    }
    await this.pull();
  }

  async exec(args: string[], input?: string | Buffer): Promise<ExecResult> {
    if (shuttingDown) throw new RendererError("renderer is shutting down");
    // the runtime CLI is only a client, so killing it would leave the container behind
    const name = `hsctikzbench-${randomBytes(6).toString("hex")}`;
    const runArgs = [
      "run",
      "--rm",
      "-i",
      "--name",
      name,
      ...SANDBOX_ARGS,
      this.image,
      DEFAULT_RENDER_BIN,
      ...args
    ];
    const controller = new AbortController();
    let removal: Promise<unknown> | undefined;
    const remove = () => (removal ??= runProcess(this.runtime, ["rm", "-f", name]).catch(() => {}));
    const execution = runProcess(this.runtime, runArgs, input, controller.signal).catch(
      async (e) => {
        // Stop the runtime client before removing its container. This also handles
        // timeouts and spawn failures.
        await remove();
        throw e;
      }
    );
    const untrack = trackContainer(async () => {
      controller.abort();
      await execution.catch(() => {});
      // The client may already have exited successfully when the signal arrived.
      await remove();
    });
    try {
      return await execution;
    } finally {
      untrack();
    }
  }

  private async pull(): Promise<void> {
    if (!isRegistryRef(this.image)) throw new RendererError(this.missingImageMessage());
    const result = await runProcess(this.runtime, ["pull", this.image]);
    if (result.code !== 0) {
      throw new RendererError(
        `${this.runtime} pull ${this.image} failed: ${result.stderr.toString("utf8").trim()}`
      );
    }
  }

  private missingImageMessage(): string {
    const missing = `image ${this.image} is not available to ${this.runtime}.`;
    if (isRegistryRef(this.image)) {
      return `${missing} Fetch it with \`${this.runtime} pull ${this.image}\``;
    }
    return (
      `${missing} Build and load it with:\n` +
      `  nix build .#image && ${this.runtime} load < result\n` +
      `or pass --renderer-image to pull instead.`
    );
  }
}

export interface RendererFlags {
  readonly renderer: string;
  readonly rendererImage: string;
  readonly pull: PullPolicy;
}

export async function createRenderer(flags: RendererFlags): Promise<Renderer> {
  const bin = process.env["HSCTIKZBENCH_RENDER_BIN"] ?? DEFAULT_RENDER_BIN;
  if (flags.renderer === "local") return new LocalRenderer(bin);
  if (flags.renderer !== "auto") {
    return new ContainerRenderer(flags.renderer, flags.rendererImage, flags.pull);
  }

  for (const runtime of CONTAINER_RUNTIMES) {
    if ((await resolveBin(runtime)) !== undefined) {
      return new ContainerRenderer(runtime, flags.rendererImage, flags.pull);
    }
  }
  if ((await resolveBin(bin)) !== undefined) return new LocalRenderer(bin);

  throw new RendererError(
    [
      "no way to run the renderer. Either:",
      `  install a container runtime (${CONTAINER_RUNTIMES.join(", ")}) and load the image with \`nix build .#image\`, or`,
      "  install the renderer itself with `nix profile install .#renderer` and pass --renderer local"
    ].join("\n")
  );
}

async function runProcess(
  bin: string,
  args: string[],
  input?: string | Buffer,
  cancelSignal?: AbortSignal
): Promise<ExecResult> {
  const result = await execa(bin, args, {
    encoding: "buffer",
    input,
    cancelSignal,
    timeout: EXEC_TIMEOUT_MS,
    killSignal: "SIGKILL",
    reject: false
  });

  if (result.timedOut) {
    throw new RendererError(
      `${bin} ${args.join(" ")} did not exit within ${EXEC_TIMEOUT_MS / 1000}s`
    );
  }
  if (result.exitCode === undefined) {
    throw new RendererError(`failed to run ${bin}: ${result.shortMessage}`);
  }

  return {
    code: result.exitCode,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr)
  };
}

function isMissingImage(stderr: string): boolean {
  return /no such image|image not known|not found|unable to find/i.test(stderr);
}

function runtimeHint(runtime: string, stderr: string): string {
  if (/permission denied/i.test(stderr) && /sock/i.test(stderr)) {
    return (
      `\nThe ${runtime} socket is not readable by this user. Check its group and permissions, ` +
      `or pass --renderer local.`
    );
  }
  return `\nCheck that ${runtime} works, or pass --renderer local.`;
}

function isRegistryRef(image: string): boolean {
  const [head = "", ...rest] = image.split("/");
  return rest.length > 0 && (head === "localhost" || head.includes(".") || head.includes(":"));
}

async function resolveBin(bin: string): Promise<string | undefined> {
  if (bin.includes("/")) return (await isExecutable(bin)) ? bin : undefined;
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, bin);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const rendererFlags = {
  renderer: {
    kind: "parsed",
    parse: String,
    brief: `How to run the renderer: auto, local, or a container runtime (${CONTAINER_RUNTIMES.join(", ")})`,
    default: process.env["HSCTIKZBENCH_RENDERER"] ?? "auto"
  },
  rendererImage: {
    kind: "parsed",
    parse: String,
    brief: "Renderer image the container backends run",
    default: process.env["HSCTIKZBENCH_RENDERER_IMAGE"] ?? DEFAULT_IMAGE
  },
  pull: {
    kind: "enum",
    values: PULL_POLICIES,
    brief: "When to pull the renderer image: missing, never, always",
    default: "missing"
  }
} as const;
