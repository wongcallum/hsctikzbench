import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Interface } from "node:readline/promises";
import type {
  AuthInteraction,
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore
} from "@earendil-works/pi-ai";

type AuthFile = Record<string, Credential>;

export class FileCredentialStore implements CredentialStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return (await this.load())[providerId];
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return Object.entries(await this.load()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      options?.signal?.throwIfAborted();
      const auth = await this.load();
      const current = auth[providerId];
      const next = await fn(current);
      if (next === undefined) return current;
      auth[providerId] = next;
      await this.save(auth);
      return next;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(async () => {
      options?.signal?.throwIfAborted();
      const auth = await this.load();
      if (!(providerId in auth)) return;
      delete auth[providerId];
      await this.save(auth);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => {});
    return run;
  }

  private async load(): Promise<AuthFile> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as AuthFile;
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "ENOENT") return {};
      throw e;
    }
  }

  private async save(auth: AuthFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.path);
  }
}

export function interaction(rl: Interface, log: (line: string) => void): AuthInteraction {
  return {
    async prompt(prompt) {
      if (prompt.type === "select") {
        log(prompt.message);
        prompt.options.forEach((option, i) => {
          const description = option.description ? `  ${option.description}` : "";
          log(`  ${i + 1}. ${option.label}${description}`);
        });
        const answer = await rl.question(`Enter number (1-${prompt.options.length}): `);
        const selected = prompt.options[Number.parseInt(answer, 10) - 1];
        if (!selected) throw new Error(`invalid selection: ${answer}`);
        return selected.id;
      }
      const hint = prompt.placeholder ? ` (${prompt.placeholder})` : "";
      return rl.question(`${prompt.message}${hint}: `, { signal: prompt.signal });
    },
    notify(event) {
      switch (event.type) {
        case "auth_url":
          log(`\nOpen this URL in your browser:\n${event.url}`);
          if (event.instructions) log(event.instructions);
          break;
        case "device_code":
          log(`\nOpen this URL in your browser:\n${event.verificationUri}`);
          log(`Enter code: ${event.userCode}`);
          break;
        case "info":
        case "progress":
          log(event.message);
          break;
      }
    }
  };
}
