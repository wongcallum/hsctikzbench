import {
  Badge,
  Flex,
  Grid,
  Heading,
  RadioCards,
  ScrollArea,
  Separator,
  Text
} from "@radix-ui/themes";
import type { ReactNode } from "react";
import { hasSubmission, type Run, type SampleSummary } from "../shared/types.ts";
import { cropUrl, runFileUrl } from "./api.ts";
import { RunBadges } from "./badges.tsx";
import { runLabel, sampleLabel, words } from "./format.ts";
import { ImagePane } from "./ImagePane.tsx";
import { RenderStrip } from "./RenderStrip.tsx";

interface Props {
  sample: SampleSummary;
  run: Run | null;
  /** The sample's runs to offer, in listing order. */
  runs: Run[];
  dirty: boolean;
  selectedRender: string | null;
  onSelectRun: (id: string) => void;
  onSelectRender: (name: string | null) => void;
  error: string | null;
  /** Width of the right-hand panel column. */
  panelWidth?: string;
  /** The panel shown in the right column. */
  children: ReactNode;
}

export function SampleView({
  sample,
  run,
  runs,
  dirty,
  selectedRender,
  onSelectRun,
  onSelectRender,
  error,
  panelWidth = "360px",
  children
}: Props) {
  const submittedRender = run && hasSubmission(run) ? (run.renders.at(-1) ?? null) : null;
  const result = run ? resultImage(run, selectedRender) : null;

  return (
    <Grid columns={`1fr auto ${panelWidth}`} minHeight="0" minWidth="0">
      <Flex direction="column" minHeight="0" minWidth="0">
        <Flex align="center" gap="2" p="4" pb="2" wrap="wrap">
          <Heading size="3">{sampleLabel(sample)}</Heading>
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
          {dirty && (
            <Badge color="orange" variant="soft" size="1">
              unsaved
            </Badge>
          )}
          {run?.result?.error && (
            <Text size="2" color="red">
              {run.result.error}
            </Text>
          )}
        </Flex>
        {runs.length > 0 && (
          <Flex overflowX="auto" px="4" pb="3" flexShrink="0">
            <RadioCards.Root
              orientation="horizontal"
              columns={`repeat(${runs.length}, max-content)`}
              gap="2"
              size="1"
              value={run?.id ?? ""}
              onValueChange={onSelectRun}
            >
              {runs.map((candidate) => (
                <RadioCards.Item key={candidate.id} value={candidate.id}>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      {runLabel(sample.runs, candidate)}
                    </Text>
                    {candidate.source?.model && (
                      <Text size="1" color="gray">
                        {candidate.source.model.model} · {candidate.source.model.reasoning}
                      </Text>
                    )}
                    <Flex align="center" gap="2" wrap="wrap">
                      <RunBadges sample={sample} run={candidate} />
                    </Flex>
                  </Flex>
                </RadioCards.Item>
              ))}
            </RadioCards.Root>
          </Flex>
        )}
        <Grid columns="2" gap="3" px="4" flexGrow="1" minHeight="0">
          <ImagePane
            label="Reference"
            src={sample.hasCrop ? cropUrl(sample.stem) : null}
            emptyText="No crop; run dataset build."
          />
          <ImagePane
            label="Result"
            detail={result?.detail}
            src={result?.src ?? null}
            emptyText={run ? (run.progress?.lastLine ?? "no renders") : "no run"}
          />
        </Grid>
        {run && (
          <RenderStrip
            run={run}
            selected={selectedRender ?? submittedRender ?? run.renders.at(-1) ?? ""}
            submitted={submittedRender}
            onSelect={(name) => onSelectRender(name === submittedRender ? null : name)}
          />
        )}
      </Flex>
      <Separator orientation="vertical" size="4" />
      <Flex direction="column" gap="3" p="4" minHeight="0" minWidth="0">
        {error && (
          <Text size="1" color="red" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </Text>
        )}
        <ScrollArea type="auto" scrollbars="vertical">
          {children}
        </ScrollArea>
      </Flex>
    </Grid>
  );
}

/** Picks the image for the result pane: an explicitly selected render, else the submission. */
function resultImage(run: Run, selected: string | null) {
  const last = run.renders.at(-1) ?? null;
  const submitted = hasSubmission(run);
  if (selected !== null) {
    const note = submitted && selected === last ? " (submitted)" : "";
    return { src: runFileUrl(run.id, `renders/${selected}`), detail: `renders/${selected}${note}` };
  }
  if (submitted) return { src: runFileUrl(run.id, "submission.png"), detail: "submission.png" };
  if (last === null) return null;
  return {
    src: runFileUrl(run.id, `renders/${last}`),
    detail: `renders/${last} (last render, not submitted)`
  };
}
