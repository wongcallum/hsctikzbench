import { Box, Button, DataList, Flex, Heading, Kbd, Link, Tabs, Text } from "@radix-ui/themes";
import { useEffect, useState, type ReactNode } from "react";
import type { LogLine, Run } from "../shared/types.ts";
import { runFileUrl } from "./api.ts";
import { duration, money, words } from "./format.ts";
import { LogLines } from "./LogPane.tsx";
import { pre, Transcript, type TranscriptFile } from "./Transcript.tsx";

interface Props {
  run: Run | null;
  busy: boolean;
  onReset: () => void;
  /** The job's log lines for this sample, when the batch page has them. */
  lines?: LogLine[];
}

/** Everything the owner may know about a run: provenance, cost, transcript, source and log. */
export function DetailsPanel({ run, busy, onReset, lines }: Props) {
  if (!run) {
    return (
      <Flex direction="column" gap="3">
        <Heading size="3">Run</Heading>
        <Text size="2" color="gray">
          No run for this sample.
        </Text>
      </Flex>
    );
  }
  return (
    <Tabs.Root defaultValue="details">
      <Tabs.List>
        <Tabs.Trigger value="details">Details</Tabs.Trigger>
        <Tabs.Trigger value="transcript">Transcript</Tabs.Trigger>
        <Tabs.Trigger value="source">Source</Tabs.Trigger>
        {lines && <Tabs.Trigger value="log">Log</Tabs.Trigger>}
      </Tabs.List>
      <Box pt="3">
        <Tabs.Content value="details">
          <Details run={run} busy={busy} onReset={onReset} />
        </Tabs.Content>
        <Tabs.Content value="transcript">
          <TranscriptLoader run={run} />
        </Tabs.Content>
        <Tabs.Content value="source">
          <SourceLoader run={run} />
        </Tabs.Content>
        {lines && (
          <Tabs.Content value="log">
            <LogLines lines={lines} empty="No log lines for this sample." />
          </Tabs.Content>
        )}
      </Box>
    </Tabs.Root>
  );
}

function Details({ run, busy, onReset }: { run: Run; busy: boolean; onReset: () => void }) {
  const source = run.source;
  const model = source?.model ?? null;
  const result = run.result;
  const judgement = run.judgement;
  return (
    <Flex direction="column" gap="3">
      <DataList.Root size="2">
        {source && <Item label="Batch">{source.batch}</Item>}
        {model && (
          <>
            <Item label="Model">
              {model.provider}/{model.model}
            </Item>
            <Item label="Reasoning">{model.reasoning}</Item>
          </>
        )}
        <Item label="Status">{result ? words(result.status) : run.phase}</Item>
        {result && (
          <>
            <Item label="Turns">{result.turns}</Item>
            <Item label="Renders">
              {result.successfulRenders}/{result.renders} compiled
            </Item>
          </>
        )}
        {model && (
          <>
            <Item label="Duration">{duration(model.durationMs)}</Item>
            <Item label="Tokens">
              {model.usage.input.toLocaleString()} in · {model.usage.output.toLocaleString()} out
              {model.usage.cacheRead > 0 && ` · ${model.usage.cacheRead.toLocaleString()} cached`}
            </Item>
            <Item label="Cost">{money(model.usage.cost)}</Item>
            <Item label="Started">{new Date(model.startedAt).toLocaleString()}</Item>
            {model.harness && <Item label="Renderer">{model.harness.renderer}</Item>}
            {model.harness && <Item label="Fit">{model.harness.fit}</Item>}
          </>
        )}
        {!result && run.progress?.lastLine && (
          <Item label="Last line">{run.progress.lastLine}</Item>
        )}
        <Item label="Judgement">{judgement ? words(judgement.verdict) : "none"}</Item>
        {judgement?.reason && <Item label="Reason">{judgement.reason}</Item>}
        {judgement && <Item label="Judged">{new Date(judgement.judgedAt).toLocaleString()}</Item>}
      </DataList.Root>
      <Flex gap="3" wrap="wrap">
        {run.hasSubmission && (
          <Link size="2" href={runFileUrl(run.id, "submission.tex")} target="_blank">
            submission.tex
          </Link>
        )}
        {result && (
          <Link size="2" href={runFileUrl(run.id, "transcript.json")} target="_blank">
            transcript.json
          </Link>
        )}
      </Flex>
      {judgement && (
        <Flex>
          <Button size="2" variant="soft" color="gray" onClick={onReset} disabled={busy}>
            Reset judgement
          </Button>
        </Flex>
      )}
      <Text size="1" color="gray">
        <Kbd>↑</Kbd>/<Kbd>↓</Kbd> samples <Kbd>←</Kbd>/<Kbd>→</Kbd> runs
      </Text>
    </Flex>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DataList.Item>
      <DataList.Label minWidth="80px">{label}</DataList.Label>
      <DataList.Value>{children}</DataList.Value>
    </DataList.Item>
  );
}

function TranscriptLoader({ run }: { run: Run }) {
  const done = run.phase !== "running" && run.phase !== "pending";
  const [state, setState] = useState<{ file: TranscriptFile | null; error: string | null }>({
    file: null,
    error: null
  });
  useEffect(() => {
    if (!done) return;
    let cancelled = false;
    fetch(runFileUrl(run.id, "transcript.json"))
      .then(async (res) => {
        if (!res.ok)
          throw new Error(res.status === 404 ? "no transcript written" : await res.text());
        return (await res.json()) as TranscriptFile;
      })
      .then(
        (file) => !cancelled && setState({ file, error: null }),
        (e: Error) => !cancelled && setState({ file: null, error: e.message })
      );
    return () => {
      cancelled = true;
    };
  }, [run.id, done]);
  if (!done) return <Text color="gray">The transcript is written when the sample finishes.</Text>;
  if (state.error) return <Text color="gray">{state.error}</Text>;
  if (!state.file) return <Text color="gray">Loading transcript…</Text>;
  return <Transcript file={state.file} imageUrl={(name) => runFileUrl(run.id, name)} />;
}

function SourceLoader({ run }: { run: Run }) {
  const has = run.hasSubmission;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!has) return;
    let cancelled = false;
    fetch(runFileUrl(run.id, "submission.tex"))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.statusText))))
      .then(
        (t) => !cancelled && setText(t),
        () => !cancelled && setText(null)
      );
    return () => {
      cancelled = true;
    };
  }, [run.id, has]);
  if (!has) return <Text color="gray">No submission, so no source to show.</Text>;
  if (text === null) return <Text color="gray">Loading source…</Text>;
  return <pre style={pre}>{text}</pre>;
}
