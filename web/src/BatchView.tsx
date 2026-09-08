import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Grid,
  Heading,
  ScrollArea,
  Text
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BatchDetail, Job, JobProgress, LogLine, SampleState } from "../shared/types.ts";
import { cancelJob, fetchBatch, subscribeJob } from "./api.ts";
import { duration, jobTone, money, sampleLabel, sampleStatus, timeOf } from "./format.ts";
import { hrefFor, navigate } from "./location.ts";
import { isShown, LogPane } from "./LogPane.tsx";
import { SampleDetail } from "./SampleDetail.tsx";
import { Thumb } from "./Thumb.tsx";

const POLL_RUNNING_MS = 2500;
const POLL_IDLE_MS = 15_000;
const MAX_LINES = 8000;

interface Props {
  name: string;
  stem: string | null;
  onChanged: () => void;
}

type Filter = "all" | "submitted" | "max_turns" | "error" | "running" | "pending" | "interrupted";

const FILTERS: [Filter, string][] = [
  ["all", "all"],
  ["submitted", "submitted"],
  ["max_turns", "max turns"],
  ["error", "error"],
  ["interrupted", "interrupted"],
  ["running", "running"],
  ["pending", "pending"]
];

export function BatchView({ name, stem, onChanged }: Props) {
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "open" | "lost">("idle");
  const [filter, setFilter] = useState<Filter>("all");
  const [logFilter, setLogFilter] = useState("");
  const [showLog, setShowLog] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const nextLine = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await fetchBatch(name);
      setDetail(next);
      setError(null);
      setJob(next.job);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = job?.status === "running";
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void load();
      },
      running ? POLL_RUNNING_MS : POLL_IDLE_MS
    );
    return () => clearInterval(timer);
  }, [load, running]);

  const jobId = job?.id ?? null;
  useEffect(() => {
    if (!jobId) return;
    nextLine.current = 0;
    setLines([]);
    let closed = false;
    let close: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      close = subscribeJob(
        jobId,
        nextLine.current,
        (event) => {
          setStreamState("open");
          if (event.type === "line") {
            nextLine.current = event.line.n + 1;
            setLines((prev) => {
              const next =
                prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
              next.push(event.line);
              return next;
            });
          } else if (event.type === "progress") {
            setProgress(event.progress);
          } else if (event.type === "status") {
            setJob((prev) => {
              if (prev && prev.status !== event.job.status) {
                void load();
                onChanged();
              }
              return event.job;
            });
          }
        },
        () => {
          if (closed) return;
          setStreamState("lost");
          close?.();
          retry = setTimeout(open, 3000);
        }
      );
    };
    open();
    return () => {
      closed = true;
      close?.();
      if (retry) clearTimeout(retry);
    };
  }, [jobId, load, onChanged]);

  // Progress from the stream is fresher than the polled detail; merge it in.
  const samples = useMemo<SampleState[]>(() => {
    if (!detail) return [];
    if (!progress) return detail.samples;
    return detail.samples.map((s) => {
      const p = progress.samples[s.stem];
      if (!p) return s;
      const phase = s.phase === "pending" && p.turn ? "running" : s.phase;
      return { ...s, phase, progress: p };
    });
  }, [detail, progress]);

  const counts = useMemo(() => {
    const c = {
      all: samples.length,
      submitted: 0,
      max_turns: 0,
      error: 0,
      running: 0,
      pending: 0,
      interrupted: 0
    };
    for (const s of samples) {
      if (s.phase === "done" && s.result) c[s.result.status]++;
      else if (s.phase !== "done") c[s.phase]++;
    }
    return c;
  }, [samples]);

  const visible = samples.filter((s) =>
    filter === "all" ? true : s.phase === "done" ? s.result?.status === filter : s.phase === filter
  );
  const selected = stem ? (samples.find((s) => s.stem === stem) ?? null) : null;
  const liveCost = useMemo(() => {
    if (!detail) return 0;
    let cost = detail.cost;
    for (const s of samples) if (s.phase !== "done" && s.progress?.cost) cost += s.progress.cost;
    return cost;
  }, [detail, samples]);

  const cancel = async () => {
    if (!job || !window.confirm("Stop this job? Samples in progress will be interrupted.")) return;
    setCancelling(true);
    try {
      await cancelJob(job.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  if (error && !detail) {
    return (
      <Box p="4">
        <Heading size="5" mb="3">
          {name}
        </Heading>
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      </Box>
    );
  }
  if (!detail) {
    return (
      <Box p="4">
        <Text color="gray">Loading {name}…</Text>
      </Box>
    );
  }

  const started = job?.startedAt ? Date.parse(job.startedAt) : null;
  const ended = job?.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const model = job
    ? `${job.params.provider}/${job.params.model} · ${job.params.reasoning}`
    : samples[0]?.result
      ? `${samples[0].result.provider}/${samples[0].result.model} · ${samples[0].result.reasoning}`
      : null;

  return (
    <Flex direction="column" height="100%" minWidth="0">
      <Flex direction="column" gap="3" p="4" pb="3" flexShrink="0">
        <Flex align="center" gap="3" wrap="wrap">
          <Heading size="5">{name}</Heading>
          {job && (
            <Badge color={jobTone[job.status]} variant="soft">
              {job.status}
            </Badge>
          )}
          {streamState === "lost" && (
            <Badge color="orange" variant="soft">
              reconnecting…
            </Badge>
          )}
          <Flex gap="2" ml="auto">
            <Button asChild variant="soft" size="2">
              <a
                href={hrefFor({ page: "launch", from: name })}
                title="Open the new run form with this batch's options filled in"
              >
                New run like this
              </a>
            </Button>
            {running && (
              <Button color="red" variant="soft" size="2" onClick={cancel} disabled={cancelling}>
                {cancelling ? "Stopping…" : "Stop"}
              </Button>
            )}
          </Flex>
        </Flex>
        <Flex gap="5" wrap="wrap">
          {model && <Stat label="model">{model}</Stat>}
          <Stat label="samples">
            {counts.submitted + counts.max_turns + counts.error} / {samples.length} finished
          </Stat>
          <Stat label="cost">{money(liveCost)}</Stat>
          {started && <Stat label={running ? "elapsed" : "took"}>{duration(ended - started)}</Stat>}
          {job && <Stat label="started">{timeOf(job.startedAt ?? job.createdAt)}</Stat>}
          {job?.params.jobs && <Stat label="parallel">{job.params.jobs}</Stat>}
        </Flex>
        {job?.error && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{job.error}</Callout.Text>
          </Callout.Root>
        )}
        {error && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        {job && (
          <details>
            <summary>
              <Text size="1" color="gray">
                command
              </Text>
            </summary>
            <Code
              size="1"
              variant="ghost"
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {job.command.join(" ")}
            </Code>
          </details>
        )}
      </Flex>

      <Box flexGrow="1" minHeight="0">
        <ScrollArea type="auto" scrollbars="vertical">
          <Box px="4" pb="4">
            {selected ? (
              <SampleDetail
                batch={name}
                sample={selected}
                lines={lines.filter((l) => isShown(l) && l.text.includes(selected.stem))}
                backHref={hrefFor({ page: "batch", name, stem: null })}
              />
            ) : (
              <Flex direction="column" gap="3">
                <Flex gap="2" wrap="wrap">
                  {FILTERS.map(([key, label]) =>
                    key === "all" || counts[key] > 0 ? (
                      <Button
                        key={key}
                        size="1"
                        variant={filter === key ? "solid" : "soft"}
                        color="gray"
                        onClick={() => setFilter(key)}
                      >
                        {label}{" "}
                        <Text color={filter === key ? undefined : "gray"}>{counts[key]}</Text>
                      </Button>
                    ) : null
                  )}
                </Flex>
                <Grid columns="repeat(auto-fill, minmax(280px, 1fr))" gap="3">
                  {visible.map((s) => (
                    <SampleCard key={s.stem} batch={name} sample={s} />
                  ))}
                </Grid>
                {visible.length === 0 && <Text color="gray">Nothing matches this filter.</Text>}
              </Flex>
            )}
          </Box>
        </ScrollArea>
      </Box>
      {job && (
        <LogPane
          lines={lines}
          filter={logFilter}
          onFilter={setLogFilter}
          open={showLog}
          onToggle={() => setShowLog((v) => !v)}
          running={running}
        />
      )}
    </Flex>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex direction="column">
      <Text size="1" color="gray">
        {label}
      </Text>
      <Text size="2">{children}</Text>
    </Flex>
  );
}

function SampleCard({ batch, sample }: { batch: string; sample: SampleState }) {
  const status = sampleStatus(sample);
  const latest = sample.hasSubmission ? "submission.png" : (sample.renders.at(-1) ?? null);
  const open = () => navigate({ page: "batch", name: batch, stem: sample.stem });
  return (
    <Card asChild size="2">
      <a
        href={hrefFor({ page: "batch", name: batch, stem: sample.stem })}
        onClick={(e) => (e.preventDefault(), open())}
        style={{ display: "block" }}
      >
        <Flex direction="column" gap="2">
          <Flex gap="2">
            <Thumb kind="crop" stem={sample.stem} missing={!sample.hasCrop} label="reference" />
            <Thumb
              kind="run"
              batch={batch}
              stem={sample.stem}
              file={latest}
              label={
                latest ? (sample.hasSubmission ? "submission" : "latest render") : "no render yet"
              }
            />
          </Flex>
          <Flex align="center" justify="between" gap="2">
            <Text size="2" weight="bold">
              {sampleLabel(sample)}
            </Text>
            <Badge color={status.tone} variant="soft" size="1">
              {status.text}
            </Badge>
          </Flex>
          <Flex justify="between" gap="2">
            <Text size="1" color="gray">
              {sample.exam}
            </Text>
            <Text size="1" color="gray">
              {sample.result
                ? `${sample.result.turns} turns · ${money(sample.result.usage.cost)}`
                : sample.progress?.cost
                  ? money(sample.progress.cost)
                  : ""}
            </Text>
          </Flex>
          {sample.phase === "running" && sample.progress?.lastLine && (
            <Text size="1" color="gray" truncate title={sample.progress.lastLine}>
              {sample.progress.lastLine}
            </Text>
          )}
          {sample.result?.error && (
            <Text size="1" color="red" truncate title={sample.result.error}>
              {sample.result.error}
            </Text>
          )}
        </Flex>
      </a>
    </Card>
  );
}
