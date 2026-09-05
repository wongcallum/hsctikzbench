import { fileURLToPath } from "node:url";
import type { CommandContext } from "@stricli/core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { FileCredentialStore } from "./auth.ts";

export interface LocalContext extends CommandContext {
  readonly process: NodeJS.Process;
}

export const DEFAULT_AUTH_FILE = fileURLToPath(new URL("../auth.json", import.meta.url));

export const authFlag = {
  kind: "parsed",
  parse: String,
  brief: "Path to the credentials file (same format as `pi-ai login`)",
  default: DEFAULT_AUTH_FILE
} as const;

export function createModels(authFile: string) {
  return builtinModels({ credentials: new FileCredentialStore(authFile) });
}
