import { Box, Button, Flex } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BatchSample as BatchSampleData, LogLine, SampleSummary } from "../shared/types.ts";
import { clearJudgement, fetchSample } from "./api.ts";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { hrefFor, navigate } from "./location.ts";
import { SampleView } from "./SampleView.tsx";

interface Props {
  batch: string;
  /** The batch page's copy of the sample, kept live by its polling and job stream. */
  sample: BatchSampleData;
  lines: LogLine[];
  backHref: string;
  /** Called after a change the batch page should reload for. */
  onChanged: () => void;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One sample on the batch page. The batch's own run comes from the page and stays live; the
 * sample's runs in other batches are fetched so the selector can hop between them.
 */
export function BatchSample({ batch, sample: live, lines, backHref, onChanged }: Props) {
  const [summary, setSummary] = useState<SampleSummary | null>(null);
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const reset = useCallback(() => {
    if (busy || !live.run.judgement) return;
    if (!window.confirm("Reset the saved judgement for this run?")) return;
    setBusy(true);
    setError(null);
    clearJudgement(live.run.id)
      .then(onChanged, (e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }, [busy, live.run, onChanged]);

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
        dirty={false}
        selectedRender={selectedRender}
        onSelectRun={selectRun}
        onSelectRender={setSelectedRender}
        error={error}
        panelWidth="clamp(360px, 30%, 480px)"
      >
        <DetailsPanel run={live.run} busy={busy} onReset={reset} lines={lines} />
      </SampleView>
    </Flex>
  );
}

export const batchSampleHref = (batch: string, stem: string) =>
  hrefFor({ page: "batch", name: batch, stem });
