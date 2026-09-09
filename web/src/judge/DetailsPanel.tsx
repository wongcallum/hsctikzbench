import { Button, DataList, Flex, Heading, Kbd, Link, Text } from "@radix-ui/themes";
import { runFileUrl } from "./api.ts";
import type { Run } from "../../shared/judge.ts";

interface Props {
  run: Run | null;
  busy: boolean;
  onReset: () => void;
}

export function DetailsPanel({ run, busy, onReset }: Props) {
  return (
    <Flex direction="column" gap="3">
      <Heading size="3">Run</Heading>
      {run ? (
        <Details run={run} busy={busy} onReset={onReset} />
      ) : (
        <Text size="2" color="gray">
          No run for this sample.
        </Text>
      )}
      <Text size="1" color="gray">
        <Kbd>↑</Kbd>/<Kbd>↓</Kbd> samples <Kbd>←</Kbd>/<Kbd>→</Kbd> runs
      </Text>
    </Flex>
  );
}

function Details({ run, busy, onReset }: { run: Run; busy: boolean; onReset: () => void }) {
  const source = run.source;
  const model = source?.model ?? null;
  const result = run.result;
  const judgement = run.judgement;
  return (
    <>
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
        <Item label="Status">{result ? result.status.replaceAll("_", " ") : "running"}</Item>
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
            <Item label="Duration">{(model.durationMs / 1000).toFixed(0)}s</Item>
            <Item label="Tokens">
              {model.usage.input.toLocaleString()} in · {model.usage.output.toLocaleString()} out
              {model.usage.cacheRead > 0 && ` · ${model.usage.cacheRead.toLocaleString()} cached`}
            </Item>
            <Item label="Cost">${model.usage.cost.toFixed(4)}</Item>
            <Item label="Started">{new Date(model.startedAt).toLocaleString()}</Item>
          </>
        )}
        <Item label="Judgement">{judgement ? judgement.verdict.replaceAll("_", " ") : "none"}</Item>
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
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DataList.Item>
      <DataList.Label minWidth="80px">{label}</DataList.Label>
      <DataList.Value>{children}</DataList.Value>
    </DataList.Item>
  );
}
