import { Callout, Flex, Grid, Separator, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SampleSummary } from "../shared/types.ts";
import { fetchSamples } from "./api.ts";
import { SampleBadges } from "./badges.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import type { JudgeLocation } from "./location.ts";
import { SampleSidebar } from "./SampleSidebar.tsx";
import { SampleView } from "./SampleView.tsx";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function claimedByGroup(group: Element, key: string): boolean {
  const orientation = group.getAttribute("aria-orientation");
  if (key === "ArrowUp" || key === "ArrowDown") return orientation !== "horizontal";
  if (key === "ArrowLeft" || key === "ArrowRight") return orientation !== "vertical";
  return false;
}

interface Props {
  location: JudgeLocation;
  setLocation: (next: JudgeLocation) => void;
}

const badges = (sample: SampleSummary) => <SampleBadges sample={sample} />;

/** Owner only: every run of every sample, with provenance. */
export function ViewApp({ location, setLocation }: Props) {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const refreshId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    setLoading(true);
    try {
      const next = await fetchSamples();
      if (id !== refreshId.current) return;
      setSamples(next);
      setError(null);
    } catch (e) {
      if (id !== refreshId.current) return;
      setError(errorMessage(e));
    } finally {
      if (id === refreshId.current) setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const sample = samples.find((s) => s.stem === location.stem) ?? samples[0] ?? null;
  const runs = sample?.runs ?? [];
  const run = runs.find((r) => r.id === location.run) ?? runs[0] ?? null;

  useEffect(() => {
    if (sample && (sample.stem !== location.stem || (run?.id ?? null) !== location.run)) {
      setLocation({ mode: "view", stem: sample.stem, run: run?.id ?? null });
    }
  }, [sample, run, location, setLocation]);

  const select = useCallback(
    (stem: string, runId: string | null) => setLocation({ mode: "view", stem, run: runId }),
    [setLocation]
  );

  // Moving between samples keeps the batch in view where it has a run.
  const selectSample = useCallback(
    (next: SampleSummary) => {
      const batch = run?.source?.batch;
      const match = batch === undefined ? null : next.runs.find((r) => r.source?.batch === batch);
      select(next.stem, match?.id ?? null);
    },
    [run, select]
  );
  const selectStem = useCallback(
    (stem: string) => {
      const next = samples.find((s) => s.stem === stem);
      if (next) selectSample(next);
    },
    [samples, selectSample]
  );
  const refreshFromSidebar = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    if (!sample) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[role=dialog], input, textarea")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const group = target?.closest("[role=radiogroup]");
      if (group && claimedByGroup(group, event.key)) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const index = samples.findIndex(({ stem }) => stem === sample.stem);
        const next = samples[event.key === "ArrowDown" ? index + 1 : index - 1];
        if (next) {
          event.preventDefault();
          selectSample(next);
        }
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const index = runs.findIndex(({ id }) => id === run?.id);
        const next = runs[event.key === "ArrowRight" ? index + 1 : index - 1];
        if (next) {
          event.preventDefault();
          select(sample.stem, next.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [samples, sample, run, runs, select, selectSample]);

  return (
    <Grid columns="280px auto 1fr" height="100%">
      <SampleSidebar
        heading="Samples"
        samples={samples}
        empty="The manifest has no samples."
        selected={sample?.stem ?? null}
        loading={loading}
        badges={badges}
        onSelect={selectStem}
        onRefresh={refreshFromSidebar}
      />
      <Separator orientation="vertical" size="4" />
      {error ? (
        <Flex p="4">
          <Callout.Root color="red">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        </Flex>
      ) : sample ? (
        <SampleView
          key={`${sample.stem}/${run?.id ?? ""}`}
          sample={sample}
          run={run}
          selectedRender={selectedRender}
          onSelectRun={(id) => select(sample.stem, id)}
          onSelectRender={setSelectedRender}
        >
          <DetailsPanel run={run} />
        </SampleView>
      ) : (
        <Flex p="4">
          <Text color="gray">{loading ? "Loading…" : "The manifest has no samples."}</Text>
        </Flex>
      )}
    </Grid>
  );
}
