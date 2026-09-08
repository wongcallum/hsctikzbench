import {
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Code,
  Flex,
  Grid,
  Heading,
  Link,
  RadioCards,
  ScrollArea,
  Select,
  Text,
  TextField
} from "@radix-ui/themes";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { BatchSummary, Info, LaunchParams, ProviderInfo } from "../shared/types.ts";
import { fetchBatch, launchJob } from "./api.ts";
import { hrefFor, navigate } from "./location.ts";
import {
  clearStoredOptions,
  loadStoredOptions,
  optionsFromBatch,
  saveStoredOptions,
  type RunOptions
} from "./options.ts";

interface Props {
  from: string | null;
  info: Info | null;
  infoError: string | null;
  onRetry: () => void;
  batches: BatchSummary[];
  onLaunched: () => void;
}

type Seed =
  | { kind: "stored"; options: Partial<RunOptions> }
  | { kind: "batch"; name: string; options: Partial<RunOptions> };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function defaultBatchName(model: string, reasoning: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return [date, slug(model), slug(reasoning)].filter(Boolean).join("-");
}

function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollArea type="auto" scrollbars="vertical">
      <Box p="4" maxWidth="880px">
        <Flex direction="column" gap="4">
          {children}
        </Flex>
      </Box>
    </ScrollArea>
  );
}

function Problem({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Page>
      <Heading size="5">New run</Heading>
      <Callout.Root color="red">
        <Callout.Text>{children}</Callout.Text>
      </Callout.Root>
      {action}
    </Page>
  );
}

export function Launch({ from, info, infoError, onRetry, batches, onLaunched }: Props) {
  const [seed, setSeed] = useState<Seed | null>(() =>
    from ? null : { kind: "stored", options: loadStoredOptions() }
  );
  const [seedError, setSeedError] = useState<string | null>(null);
  // Bumped to remount the form with fresh defaults.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!from) return;
    let stale = false;
    fetchBatch(from).then(
      (detail) => {
        if (!stale) setSeed({ kind: "batch", name: from, options: optionsFromBatch(detail) });
      },
      (e: Error) => {
        if (!stale) setSeedError(e.message);
      }
    );
    return () => {
      stale = true;
    };
  }, [from]);

  if (infoError) {
    return (
      <Problem
        action={
          <Box>
            <Button variant="soft" onClick={onRetry}>
              Retry
            </Button>
          </Box>
        }
      >
        Could not reach the server: {infoError}
      </Problem>
    );
  }
  if (!info) {
    return (
      <Page>
        <Heading size="5">New run</Heading>
        <Text color="gray">Loading providers and the dataset…</Text>
      </Page>
    );
  }
  if (info.problems.length > 0) {
    return (
      <Problem
        action={
          <Box>
            <Button variant="soft" onClick={onRetry}>
              Check again
            </Button>
          </Box>
        }
      >
        The benchmark cannot be launched: {info.problems.join("; ")}
      </Problem>
    );
  }
  if (seedError) {
    return (
      <Problem
        action={
          <Box>
            <Button asChild variant="soft">
              <a href={hrefFor({ page: "launch", from: null })}>
                Start from the remembered options
              </a>
            </Button>
          </Box>
        }
      >
        Could not read the options of {from}: {seedError}
      </Problem>
    );
  }
  if (!seed) {
    return (
      <Page>
        <Heading size="5">New run</Heading>
        <Text color="gray">Reading the options of {from}…</Text>
      </Page>
    );
  }
  const reset = () => {
    clearStoredOptions();
    if (from) {
      // Leave the prefilled address, or a reload would copy the batch again.
      navigate({ page: "launch", from: null });
      return;
    }
    setSeed({ kind: "stored", options: {} });
    setGeneration((g) => g + 1);
  };
  return (
    <LaunchForm
      key={generation}
      info={info}
      batches={batches}
      seed={seed}
      onReset={reset}
      onLaunched={onLaunched}
    />
  );
}

function LaunchForm({
  info,
  batches,
  seed,
  onReset,
  onLaunched
}: {
  info: Info;
  batches: BatchSummary[];
  seed: Seed;
  onReset: () => void;
  onLaunched: () => void;
}) {
  const providers = info.providers;
  const initial = seed.options;
  const [providerId, setProviderId] = useState(
    () => providers.find((p) => p.id === initial.provider)?.id ?? providers[0]?.id ?? ""
  );
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  const [modelFilter, setModelFilter] = useState("");
  const models = useMemo(() => {
    const list = provider?.models ?? [];
    const q = modelFilter.trim().toLowerCase();
    return q ? list.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(q)) : list;
  }, [provider, modelFilter]);
  const [modelId, setModelId] = useState(
    () => provider?.models.find((m) => m.id === initial.model)?.id ?? provider?.models[0]?.id ?? ""
  );
  const model = provider?.models.find((m) => m.id === modelId);
  const levels = model?.reasoning ?? ["off"];
  const [reasoning, setReasoning] = useState(initial.reasoning ?? "off");
  const [maxTurns, setMaxTurns] = useState(initial.maxTurns ?? 20);
  const [jobs, setJobs] = useState(initial.jobs ?? 4);
  const [renderer, setRenderer] = useState(() => {
    if (info.renderers.some((r) => r.id === initial.renderer)) return initial.renderer!;
    const local = info.renderers.find((r) => r.id === "local");
    const auto = info.renderers.find((r) => r.id === "auto");
    // A working local binary is the safest default when no container runtime is usable.
    return auto?.available ? "auto" : local?.available ? "local" : "auto";
  });
  const [batch, setBatch] = useState(() => defaultBatchName(model?.id ?? "", reasoning));
  const [batchTouched, setBatchTouched] = useState(false);
  const [resume, setResume] = useState(initial.resume ?? false);
  const [exams, setExams] = useState<string[]>(initial.exams ?? []);
  const [pick, setPick] = useState(initial.pick ?? false);
  const [samples, setSamples] = useState<string[]>(initial.samples ?? []);
  const [sampleFilter, setSampleFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remember the options for next time; the batch name is left out on purpose.
  useEffect(() => {
    saveStoredOptions({
      provider: providerId,
      model: modelId,
      reasoning,
      maxTurns,
      jobs,
      resume,
      renderer,
      exams,
      pick,
      samples
    });
  }, [providerId, modelId, reasoning, maxTurns, jobs, resume, renderer, exams, pick, samples]);

  useEffect(() => {
    if (!provider?.models.some((m) => m.id === modelId)) setModelId(provider?.models[0]?.id ?? "");
  }, [provider, modelId]);
  useEffect(() => {
    if (!levels.includes(reasoning)) setReasoning(levels.includes("off") ? "off" : levels[0]!);
  }, [levels, reasoning]);
  useEffect(() => {
    if (!batchTouched) setBatch(defaultBatchName(model?.id ?? "", reasoning));
  }, [model, reasoning, batchTouched]);

  const examSet = new Set(exams);
  const inScope = info.exams.filter((e) => exams.length === 0 || examSet.has(e.id));
  const scopedStems = inScope.flatMap((e) => e.samples.map((s) => s.stem));
  const scoped = new Set(scopedStems);
  const chosen = pick ? samples.filter((s) => scoped.has(s)) : scopedStems;
  const existing = batches.find((b) => b.name === batch);
  const jobRunning = existing?.jobStatus === "running";

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !model) return;
    setError(null);
    setSubmitting(true);
    const params: LaunchParams = {
      batch,
      provider: provider.id,
      model: model.id,
      reasoning,
      maxTurns,
      jobs,
      resume,
      renderer,
      exams,
      samples: pick ? chosen : []
    };
    try {
      await launchJob(params);
      onLaunched();
      navigate({ page: "batch", name: batch, stem: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <form onSubmit={submit}>
        <Flex direction="column" gap="4">
          <Flex align="baseline" gap="3" wrap="wrap">
            <Heading size="5">New run</Heading>
            <Text size="1" color="gray">
              {seed.kind === "batch" ? (
                <>
                  Options copied from{" "}
                  <Link href={hrefFor({ page: "batch", name: seed.name, stem: null })}>
                    {seed.name}
                  </Link>
                  .
                </>
              ) : (
                "Options are remembered in this browser."
              )}{" "}
              <Link href="#" onClick={(e) => (e.preventDefault(), onReset())}>
                reset to defaults
              </Link>
            </Text>
          </Flex>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="3">Model</Heading>
              <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                <Field label="Provider">
                  <Select.Root value={provider?.id ?? ""} onValueChange={setProviderId}>
                    <Select.Trigger />
                    <Select.Content>
                      {providers.map((p) => (
                        <Select.Item key={p.id} value={p.id}>
                          {providerLabel(p)}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  {provider && !provider.auth && (
                    <Hint color="orange">
                      No credentials found for {provider.id}. Set its API key environment variable
                      or run <Code>hsctikzbench login {provider.id}</Code>.
                    </Hint>
                  )}
                </Field>
                <Field label="Reasoning">
                  <Select.Root value={reasoning} onValueChange={setReasoning}>
                    <Select.Trigger />
                    <Select.Content>
                      {levels.map((l) => (
                        <Select.Item key={l} value={l}>
                          {l}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Field>
              </Grid>
              <Field label="Model">
                <TextField.Root
                  type="search"
                  placeholder="filter models"
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                />
                <Box
                  height="220px"
                  style={{ border: "1px solid var(--gray-a6)", borderRadius: "var(--radius-2)" }}
                >
                  <ScrollArea type="auto" scrollbars="vertical">
                    <Box p="2">
                      {models.length === 0 ? (
                        <Text size="1" color="gray">
                          No models match.
                        </Text>
                      ) : (
                        <RadioCards.Root
                          orientation="vertical"
                          columns="1"
                          gap="1"
                          size="1"
                          value={modelId}
                          onValueChange={setModelId}
                        >
                          {models.map((m) => (
                            <RadioCards.Item key={m.id} value={m.id}>
                              <Flex direction="column" width="100%" minWidth="0">
                                <Text size="2" weight="medium" truncate>
                                  {m.id}
                                </Text>
                                {m.name && m.name !== m.id && (
                                  <Text size="1" color="gray" truncate>
                                    {m.name}
                                  </Text>
                                )}
                              </Flex>
                            </RadioCards.Item>
                          ))}
                        </RadioCards.Root>
                      )}
                    </Box>
                  </ScrollArea>
                </Box>
              </Field>
              <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                <Field label="Max turns">
                  <TextField.Root
                    type="number"
                    min={1}
                    max={500}
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(Number(e.target.value))}
                  />
                </Field>
                <Field label="Parallel samples">
                  <TextField.Root
                    type="number"
                    min={1}
                    max={64}
                    value={jobs}
                    onChange={(e) => setJobs(Number(e.target.value))}
                  />
                </Field>
              </Grid>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="3">Harness</Heading>
              <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                <Field label="Renderer">
                  <Select.Root value={renderer} onValueChange={setRenderer}>
                    <Select.Trigger />
                    <Select.Content>
                      {info.renderers.map((r) => (
                        <Select.Item key={r.id} value={r.id}>
                          {r.id}
                          {r.available ? "" : " (not on PATH)"}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Hint>
                    Container backends need a working runtime and the renderer image. Pick{" "}
                    <Code>local</Code> when only the <Code>render</Code> binary is installed.
                  </Hint>
                </Field>
                <Field label="Batch name">
                  <TextField.Root
                    value={batch}
                    onChange={(e) => {
                      setBatch(e.target.value);
                      setBatchTouched(true);
                    }}
                    pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
                    required
                  />
                  <Hint>
                    Output goes to{" "}
                    <Code>
                      {info.runsDir}/{batch || "…"}
                    </Code>
                  </Hint>
                  {existing && !resume && (
                    <Hint color="orange">
                      This batch already exists. Choose another name, or enable resume to fill in
                      samples it has not finished.
                    </Hint>
                  )}
                  {jobRunning && <Hint color="red">A job is already writing to it.</Hint>}
                </Field>
              </Grid>
              <Check checked={resume} onChange={setResume}>
                Resume: skip finished samples, rerun interrupted and errored ones
              </Check>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="3">Samples</Heading>
              <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="2">
                {info.exams.map((exam) => (
                  <Check
                    key={exam.id}
                    checked={examSet.has(exam.id)}
                    onChange={() => toggle(exams, setExams, exam.id)}
                  >
                    {exam.id} <Text color="gray">({exam.samples.length})</Text>
                  </Check>
                ))}
              </Grid>
              <Text size="1" color="gray">
                {exams.length === 0
                  ? "No exams ticked: every exam is included."
                  : `${exams.length} exam(s) ticked.`}{" "}
                {exams.length > 0 && (
                  <Link href="#" onClick={(e) => (e.preventDefault(), setExams([]))}>
                    clear
                  </Link>
                )}
              </Text>
              <Check checked={pick} onChange={setPick}>
                Pick individual samples
              </Check>
              {pick && (
                <Flex direction="column" gap="2">
                  <Flex gap="2" wrap="wrap">
                    <TextField.Root
                      type="search"
                      placeholder="filter stems"
                      value={sampleFilter}
                      onChange={(e) => setSampleFilter(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="soft"
                      onClick={() => setSamples([...new Set([...samples, ...scopedStems])])}
                    >
                      Select all in scope
                    </Button>
                    <Button type="button" variant="soft" onClick={() => setSamples([])}>
                      Clear
                    </Button>
                  </Flex>
                  <Box
                    height="260px"
                    style={{ border: "1px solid var(--gray-a6)", borderRadius: "var(--radius-2)" }}
                  >
                    <ScrollArea type="auto" scrollbars="vertical">
                      <Flex direction="column" gap="1" p="2">
                        {scopedStems
                          .filter((stem) => stem.includes(sampleFilter.trim()))
                          .map((stem) => (
                            <Check
                              key={stem}
                              checked={samples.includes(stem)}
                              onChange={() => toggle(samples, setSamples, stem)}
                            >
                              <Code variant="ghost">{stem}</Code>
                            </Check>
                          ))}
                      </Flex>
                    </ScrollArea>
                  </Box>
                </Flex>
              )}
            </Flex>
          </Card>

          {error && (
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Flex align="center" gap="3" wrap="wrap">
            <Button
              type="submit"
              size="3"
              disabled={submitting || !model || chosen.length === 0 || jobRunning}
            >
              {submitting
                ? "Launching…"
                : `Run ${chosen.length} sample${chosen.length === 1 ? "" : "s"}`}
            </Button>
            {model && (
              <Text size="2" color="gray">
                {provider?.id}/{model.id}, reasoning {reasoning}, {maxTurns} turns, {jobs} at a time
              </Text>
            )}
          </Flex>
        </Flex>
      </form>
    </Page>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1">
      <Text as="label" size="2" weight="medium">
        {label}
      </Text>
      {children}
    </Flex>
  );
}

function Hint({ color, children }: { color?: "orange" | "red"; children: ReactNode }) {
  return (
    <Text size="1" color={color ?? "gray"}>
      {children}
    </Text>
  );
}

function Check({
  checked,
  onChange,
  children
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Text as="label" size="2">
      <Flex gap="2" align="center">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        <span>{children}</span>
      </Flex>
    </Text>
  );
}

const providerLabel = (p: ProviderInfo) =>
  `${p.id}${p.auth ? ` · ${p.auth}` : " · no credentials"} (${p.models.length})`;
