import { Box, Button, Flex } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BatchSample as BatchSampleData, LogLine, SampleSummary } from "../shared/types.ts";
import { fetchSample } from "./api.ts";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { hrefFor, navigate } from "./location.ts";
import { SampleView } from "./SampleView.tsx";

interface Props {
  batch: string;
  /** Kept live by the batch page's polling and job stream. */
  sample: BatchSampleData;
  lines: LogLine[];
  backHref: string;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The batch's own run comes live from the page; its runs in other batches are fetched here. */
export function BatchSample({ batch, sample: live, lines, backHref }: Props) {
  const [summary, setSummary] = useState<SampleSummary | null>(null);
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stem = live.stem;
  const phase = live.run.phase;

  // Refetched when this run finishes, since its result may change the others' ordering.
  useEffect(() => {
    let stale = false;
    fetchSample(stem).then(
      (next) => !stale && setSummary(next),
      (e: unknown) => !stale && setError(errorMessage(e))
    );
    return () => {
      stale = true;
    };
  }, [stem, phase]);

  const sample = useMemo<SampleSummary>(() => {
    const others = (summary?.stem === stem ? summary.runs : []).filter(
      (run) => run.id !== live.run.id
    );
    const runs = [live.run, ...others].sort((a, b) =>
      (a.source?.batch ?? "").localeCompare(b.source?.batch ?? "")
    );
    return { ...live, runs };
  }, [summary, stem, live]);

  const selectRun = useCallback(
    (id: string) => {
      const target = sample.runs.find((run) => run.id === id)?.source?.batch;
      if (target && target !== batch) navigate({ page: "batch", name: target, stem });
    },
    [sample, batch, stem]
  );

  return (
    <Flex direction="column" height="100%" minHeight="0">
      <Box px="4" pt="3" flexShrink="0">
        <Button asChild variant="soft" size="1">
          <a href={backHref}>← All samples</a>
        </Button>
      </Box>
      <SampleView
        key={live.run.id}
        sample={sample}
        run={live.run}
        runs={sample.runs}
        selectedRender={selectedRender}
        onSelectRun={selectRun}
        onSelectRender={setSelectedRender}
        error={error}
        panelWidth="clamp(360px, 30%, 480px)"
      >
        <DetailsPanel run={live.run} lines={lines} />
      </SampleView>
    </Flex>
  );
}

export const batchSampleHref = (batch: string, stem: string) =>
  hrefFor({ page: "batch", name: batch, stem });
