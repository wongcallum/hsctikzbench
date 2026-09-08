import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path, { delimiter } from "node:path";
import { createModels } from "hsctikzbench-cli/context";
import { examId, parseManifest, sampleStem } from "hsctikzbench-cli/manifest";
import { REASONING_LEVELS, supportedReasoningLevels } from "hsctikzbench-cli/model";
import type { Info, ManifestExam, ProviderInfo } from "../shared/types.ts";
import { config, repoProblems } from "./env.ts";

export interface LoadedManifest {
  exams: ManifestExam[];
  stems: Map<string, string>;
}

export async function loadManifest(): Promise<LoadedManifest> {
  const exams = parseManifest(JSON.parse(await readFile(config.manifest, "utf8")));
  const stems = new Map<string, string>();
  const out: ManifestExam[] = exams.map((exam) => {
    const id = examId(exam);
    return {
      id,
      course: exam.course,
      year: exam.year,
      samples: exam.samples.map((sample) => {
        const stem = sampleStem(exam, sample);
        stems.set(stem, id);
        return {
          stem,
          question: sample.question,
          option: sample.option ?? null,
          role: sample.role,
          category: sample.category
        };
      })
    };
  });
  return { exams: out, stems };
}

let providerCache: { at: number; value: Promise<ProviderInfo[]> } | undefined;
const PROVIDER_TTL_MS = 30_000;

export function listProviders(): Promise<ProviderInfo[]> {
  const now = Date.now();
  if (providerCache && now - providerCache.at < PROVIDER_TTL_MS) return providerCache.value;
  const value = (async () => {
    const models = createModels(config.authFile);
    const providers: ProviderInfo[] = [];
    for (const provider of models.getProviders()) {
      const usable = models.getModels(provider.id).filter((m) => m.input.includes("image"));
      if (usable.length === 0) continue;
      const auth = await models.checkAuth(provider.id).catch(() => undefined);
      providers.push({
        id: provider.id,
        name: provider.name ?? provider.id,
        auth: auth ? (auth.source ?? auth.type ?? "configured") : null,
        models: usable.map((m) => ({
          id: m.id,
          name: m.name,
          reasoning: supportedReasoningLevels(m)
        }))
      });
    }
    providers.sort((a, b) => Number(b.auth !== null) - Number(a.auth !== null));
    return providers;
  })();
  providerCache = { at: now, value };
  value.catch(() => (providerCache = undefined));
  return value;
}

async function onPath(bin: string): Promise<boolean> {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    try {
      await access(path.join(dir, bin), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

export async function collectInfo(): Promise<Info> {
  const problems = repoProblems();
  const base: Info = {
    runsDir: config.runsDir,
    exams: [],
    providers: [],
    reasoningLevels: [],
    renderers: [],
    problems
  };
  if (problems.length > 0) return base;
  const [manifest, providers, ...bins] = await Promise.all([
    loadManifest(),
    listProviders(),
    ...["podman", "docker", "nerdctl", process.env["HSCTIKZBENCH_RENDER_BIN"] ?? "render"].map(
      onPath
    )
  ]);
  const [podman = false, docker = false, nerdctl = false, local = false] = bins;
  return {
    ...base,
    exams: manifest.exams,
    providers,
    reasoningLevels: [...REASONING_LEVELS],
    renderers: [
      { id: "auto", available: podman || docker || nerdctl || local },
      { id: "local", available: local },
      { id: "podman", available: podman },
      { id: "docker", available: docker },
      { id: "nerdctl", available: nerdctl }
    ]
  };
}
