import {
  Badge,
  Box,
  Button,
  Callout,
  Code,
  DataList,
  Flex,
  Grid,
  Heading,
  RadioCards,
  Tabs,
  Text
} from "@radix-ui/themes";
import { useEffect, useState, type ReactNode } from "react";
import type { LogLine, SampleState } from "../shared/types.ts";
import { cropUrl, runFileUrl } from "./api.ts";
import { duration, money, sampleLabel, sampleStatus, words } from "./format.ts";
import { ImagePane } from "./judge/ImagePane.tsx";
import { LogLines } from "./LogPane.tsx";
import { pre, Transcript, type TranscriptFile } from "./Transcript.tsx";

interface Props {
  batch: string;
  sample: SampleState;
  lines: LogLine[];
  backHref: string;
}

export function SampleDetail({ batch, sample, lines, backHref }: Props) {
  const images = [
    ...(sample.hasSubmission ? ["submission.png"] : []),
    ...sample.renders.slice().reverse()
  ];
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked && images.includes(picked) ? picked : (images[0] ?? null);
  const status = sampleStatus(sample);
  const result = sample.result;
  const done = sample.phase !== "running" && sample.phase !== "pending";

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2" wrap="wrap">
        <Button asChild variant="soft" size="1">
          <a href={backHref}>← All samples</a>
        </Button>
        <Heading size="4">{sampleLabel(sample)}</Heading>
        <Badge color={status.tone} variant="soft" size="1">
          {status.text}
        </Badge>
        <Text size="1" color="gray">
          {sample.stem}
        </Text>
        {sample.category && (
          <Badge color="gray" variant="outline" size="1">
            {words(sample.category)}
          </Badge>
        )}
        {sample.role && (
          <Badge color="gray" variant="outline" size="1">
            {words(sample.role)}
          </Badge>
        )}
      </Flex>
      {result?.error && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{result.error}</Callout.Text>
        </Callout.Root>
      )}

      <Grid columns="2" gap="3" height="420px">
        <ImagePane
          label="Reference"
          src={sample.hasCrop ? cropUrl(sample.stem) : null}
          emptyText="No crop; run dataset build."
        />
        <ImagePane
          label={shown ? shown.replace(".png", "") : "Result"}
          src={shown ? runFileUrl(batch, sample.stem, shown) : null}
          emptyText="no render yet"
        />
      </Grid>
      {images.length > 1 && (
        <Flex overflowX="auto">
          <RadioCards.Root
            orientation="horizontal"
            columns={`repeat(${images.length}, max-content)`}
            gap="2"
            size="1"
            value={shown ?? ""}
            onValueChange={setPicked}
          >
            {images.map((file) => (
              <RadioCards.Item key={file} value={file}>
                <Flex direction="column" align="center" gap="1">
                  <img
                    src={runFileUrl(batch, sample.stem, file)}
                    alt={file}
                    loading="lazy"
                    style={{ height: 96, backgroundColor: "white" }}
                  />
                  <Text size="1" color="gray">
                    {file.replace("renders/", "").replace(".png", "")}
                  </Text>
                </Flex>
              </RadioCards.Item>
            ))}
          </RadioCards.Root>
        </Flex>
      )}

      {result && (
        <DataList.Root size="2">
          <Item label="Status">{words(result.status)}</Item>
          <Item label="Turns">{result.turns}</Item>
          <Item label="Renders">
            {result.successfulRenders}/{result.renders} compiled
          </Item>
          <Item label="Cost">{money(result.usage.cost)}</Item>
          <Item label="Tokens">
            {result.usage.input.toLocaleString()} in · {result.usage.output.toLocaleString()} out
            {result.usage.cacheRead ? ` · ${result.usage.cacheRead.toLocaleString()} cached` : ""}
          </Item>
          <Item label="Duration">{duration(result.durationMs)}</Item>
          <Item label="Model">
            {result.provider}/{result.model} · {result.reasoning}
          </Item>
          {result.harness && <Item label="Renderer">{result.harness.renderer}</Item>}
          {result.harness && <Item label="Fit">{result.harness.fit}</Item>}
        </DataList.Root>
      )}
      {!result && sample.progress?.lastLine && (
        <Code size="1" variant="ghost">
          {sample.progress.lastLine}
        </Code>
      )}

      <Tabs.Root defaultValue="transcript">
        <Tabs.List>
          <Tabs.Trigger value="transcript">Transcript</Tabs.Trigger>
          <Tabs.Trigger value="source">Source</Tabs.Trigger>
          <Tabs.Trigger value="log">Log</Tabs.Trigger>
        </Tabs.List>
        <Box pt="3">
          <Tabs.Content value="transcript">
            <TranscriptLoader batch={batch} stem={sample.stem} done={done} />
          </Tabs.Content>
          <Tabs.Content value="source">
            <SourceLoader batch={batch} stem={sample.stem} has={sample.hasSubmission} />
          </Tabs.Content>
          <Tabs.Content value="log">
            <LogLines lines={lines} empty="No log lines for this sample." />
          </Tabs.Content>
        </Box>
      </Tabs.Root>
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

function TranscriptLoader({ batch, stem, done }: { batch: string; stem: string; done: boolean }) {
  const [state, setState] = useState<{ file: TranscriptFile | null; error: string | null }>({
    file: null,
    error: null
  });
  useEffect(() => {
    if (!done) return;
    let cancelled = false;
    fetch(runFileUrl(batch, stem, "transcript.json"))
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
  }, [batch, stem, done]);
  if (!done) return <Text color="gray">The transcript is written when the sample finishes.</Text>;
  if (state.error) return <Text color="gray">{state.error}</Text>;
  if (!state.file) return <Text color="gray">Loading transcript…</Text>;
  return <Transcript file={state.file} imageUrl={(name) => runFileUrl(batch, stem, name)} />;
}

function SourceLoader({ batch, stem, has }: { batch: string; stem: string; has: boolean }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!has) return;
    let cancelled = false;
    fetch(runFileUrl(batch, stem, "submission.tex"))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.statusText))))
      .then(
        (t) => !cancelled && setText(t),
        () => !cancelled && setText(null)
      );
    return () => {
      cancelled = true;
    };
  }, [batch, stem, has]);
  if (!has) return <Text color="gray">No submission, so no source to show.</Text>;
  if (text === null) return <Text color="gray">Loading source…</Text>;
  return <pre style={pre}>{text}</pre>;
}
