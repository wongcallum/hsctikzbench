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
import { cropUrl, runFileUrl } from "./api.ts";
import { RunBadges } from "./badges.tsx";
import { ImagePane } from "./ImagePane.tsx";
import { hasSubmission, label } from "./sample.ts";
import type { Run, SampleSummary } from "./types.ts";

interface Props {
  sample: SampleSummary;
  dirty: boolean;
  selectedRender: string | null;
  onSelectRender: (name: string | null) => void;
  error: string | null;
  /** The judging panel shown in the right column. */
  children: ReactNode;
}

export function SampleView({
  sample,
  dirty,
  selectedRender,
  onSelectRender,
  error,
  children
}: Props) {
  const run = sample.run;
  const submittedRender = run && hasSubmission(run) ? (run.renders.at(-1) ?? null) : null;
  const result = run ? resultImage(sample.stem, run, selectedRender) : null;

  return (
    <Grid columns="1fr auto 360px" minHeight="0" minWidth="0">
      <Flex direction="column" minHeight="0" minWidth="0">
        <Flex align="center" gap="2" p="4" pb="2" wrap="wrap">
          <Heading size="3">{label(sample)}</Heading>
          <Text size="1" color="gray">
            {sample.stem}
          </Text>
          <Badge color="gray" variant="outline" size="1">
            {sample.category.replaceAll("_", " ")}
          </Badge>
          <Badge color="gray" variant="outline" size="1">
            {sample.role.replaceAll("_", " ")}
          </Badge>
          <RunBadges sample={sample} />
          {run?.result && (
            <Badge color="gray" variant="soft" size="1">
              {run.result.turns} turns · {run.result.renders} renders
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
            emptyText={run ? "no renders" : "no run"}
          />
        </Grid>
        {run && run.renders.length > 0 && (
          <Flex overflowX="auto" px="4" py="3" flexShrink="0">
            <RadioCards.Root
              columns={`repeat(${run.renders.length}, max-content)`}
              gap="2"
              size="1"
              value={selectedRender ?? submittedRender ?? run.renders.at(-1) ?? ""}
              onValueChange={(name) => onSelectRender(name === submittedRender ? null : name)}
            >
              {run.renders.map((name) => (
                <RadioCards.Item key={name} value={name}>
                  <Flex direction="column" align="center" gap="1">
                    <img
                      src={runFileUrl(sample.stem, `renders/${name}`)}
                      alt={name}
                      style={{ height: 96, backgroundColor: "white" }}
                    />
                    <Text size="1" color="gray">
                      {name.replace(/\.png$/, "")}
                      {name === submittedRender ? " (submitted)" : ""}
                    </Text>
                  </Flex>
                </RadioCards.Item>
              ))}
            </RadioCards.Root>
          </Flex>
        )}
      </Flex>
      <Separator orientation="vertical" size="4" />
      <Flex direction="column" gap="3" p="4" minHeight="0">
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
function resultImage(stem: string, run: Run, selected: string | null) {
  const last = run.renders.at(-1) ?? null;
  const submitted = hasSubmission(run);
  if (selected !== null) {
    const note = submitted && selected === last ? " (submitted)" : "";
    return { src: runFileUrl(stem, `renders/${selected}`), detail: `renders/${selected}${note}` };
  }
  if (submitted) return { src: runFileUrl(stem, "submission.png"), detail: "submission.png" };
  if (last === null) return null;
  return {
    src: runFileUrl(stem, `renders/${last}`),
    detail: `renders/${last} (last render, not submitted)`
  };
}
