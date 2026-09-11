import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = fileURLToPath(new URL("../../", import.meta.url));

export const CLI_DIR = join(ROOT_DIR, "cli");
export const DATASET_DIR = join(ROOT_DIR, "dataset");
export const DEFAULT_MANIFEST = join(DATASET_DIR, "manifest.json");
export const DEFAULT_PROMPT = join(CLI_DIR, "prompt.md");

export const DATA_DIR = process.env["HSCTIKZBENCH_DATA_DIR"] ?? join(ROOT_DIR, "data");
export const DEFAULT_PDFS_DIR = join(DATA_DIR, "pdfs");
export const DEFAULT_CROPS_DIR = join(DATA_DIR, "crops");
export const DEFAULT_AUTH_FILE = join(DATA_DIR, "auth.json");
