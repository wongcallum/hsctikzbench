import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchSamples, saveJudgement } from "./api.ts";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { JudgingPanel } from "./JudgingPanel.tsx";
import { useLocation } from "./location.ts";
import {
  isJudgeable,
  isPending,
  listedRuns,
  listedSamples,
  sampleRuns,
  scoreLines,
  type ScoreLine
} from "./sample.ts";
import { SampleView } from "./SampleView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { RUBRIC_VERSION, type Mode, type Run, type SampleSummary, type Verdict } from "./types.ts";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useLocation();
  const mode = location.mode;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSamples(await fetchSamples(mode === "judge"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  // Drop the previous mode's listing before refetching so the judge page never shows provenance.
  useEffect(() => {
    setSamples([]);
    void refresh();
  }, [refresh]);

  // Judging only lists samples with runs left to judge; the score line still covers every run.
  const listed = useMemo(
    () => listedSamples(samples, mode, location.stem),
    [samples, mode, location.stem]
  );
  const scores = scoreLines(samples, mode);
  // A sample with only unfinished runs is not judgeable yet, so it stays out of the listing too.
  const empty = samples.length === 0 ? "The manifest has no samples." : "Nothing left to judge.";
  const sample = listed.find((s) => s.stem === location.stem) ?? listed[0] ?? null;
  // Judging likewise only offers the runs still to judge.
  const runs = useMemo(
    () => (sample ? listedRuns(sample, mode, location.run) : []),
    [sample, mode, location.run]
  );
  const run = runs.find((r) => r.id === location.run) ?? runs[0] ?? null;

  useEffect(() => {
    if (sample && (sample.stem !== location.stem || (run?.id ?? null) !== location.run)) {
      setLocation({ mode, stem: sample.stem, run: run?.id ?? null });
    }
  }, [sample, run, location, mode, setLocation]);

  const select = useCallback(
    (stem: string, runId: string | null) => setLocation({ mode, stem, run: runId }),
    [mode, setLocation]
  );
  const setMode = useCallback(
    (next: Mode) => setLocation({ mode: next, stem: location.stem, run: location.run }),
    [location, setLocation]
  );

  const patch = useCallback(
    (runId: string, changes: Partial<Run>) =>
      setSamples((current) =>
        current.map((s) => ({
          ...s,
          runs: s.runs.map((r) => (r.id === runId ? { ...r, ...changes } : r))
        }))
      ),
    []
  );

  return (
    <Theme accentColor="gray" grayColor="slate">
      {error ? (
        <Frame
          samples={listed}
          scores={scores}
          empty={empty}
          selected={sample?.stem ?? null}
          mode={mode}
          loading={loading}
          onSelect={(stem) => select(stem, null)}
          onMode={setMode}
          onRefresh={() => void refresh()}
        >
          <Flex p="4">
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          </Flex>
        </Frame>
      ) : sample ? (
        <Workspace
          sample={sample}
          run={run}
          runs={runs}
          samples={listed}
          scores={scores}
          empty={empty}
          mode={mode}
          loading={loading}
          onSelect={select}
          onMode={setMode}
          onRefresh={refresh}
          onPatch={patch}
        />
      ) : (
        <Frame
          samples={listed}
          scores={scores}
          empty={empty}
          selected={null}
          mode={mode}
          loading={loading}
          onSelect={(stem) => select(stem, null)}
          onMode={setMode}
          onRefresh={() => void refresh()}
        >
          <Flex p="4">
            <Text color="gray">{loading ? "Loading…" : empty}</Text>
          </Flex>
        </Frame>
      )}
    </Theme>
  );
}

interface WorkspaceProps {
  sample: SampleSummary;
  run: Run | null;
  /** The sample's runs to offer, in listing order. */
  runs: Run[];
  samples: SampleSummary[];
  scores: ScoreLine[];
  empty: string;
  mode: Mode;
  loading: boolean;
  onSelect: (stem: string, runId: string | null) => void;
  onMode: (mode: Mode) => void;
  onRefresh: () => Promise<void>;
  onPatch: (runId: string, changes: Partial<Run>) => void;
}

function Workspace({
  sample,
  run,
  runs,
  samples,
  scores,
  empty,
  mode,
  loading,
  onSelect,
  onMode,
  onRefresh,
  onPatch
}: WorkspaceProps) {
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [edited, setEdited] = useState<{ verdict: Verdict | null; reason: string } | null>(null);

  const identity = `${mode}/${run?.id ?? sample.stem}`;
  const [shown, setShown] = useState(identity);
  if (shown !== identity) {
    setShown(identity);
    setSelectedRender(null);
    setSaving(false);
    setActionError(null);
    setEdited(null);
  }

  const saved = run?.judgement ?? null;
  const verdict = edited?.verdict ?? saved?.verdict ?? null;
  const reason = edited?.reason ?? saved?.reason ?? "";
  const dirty = verdict !== (saved?.verdict ?? null) || reason !== (saved?.reason ?? "");
  const viewingSubmission = selectedRender === null || selectedRender === run?.renders.at(-1);
  const canSave =
    !saving &&
    dirty &&
    verdict !== null &&
    (verdict !== "fail" || reason.trim() !== "") &&
    run !== null &&
    isJudgeable(sample, run) &&
    viewingSubmission;

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard the unsaved judgement?"),
    [dirty]
  );

  const select = useCallback(
    (stem: string, runId: string | null) => {
      if (saving) return;
      if (stem === sample.stem && runId === (run?.id ?? null)) return;
      if (confirmDiscard()) onSelect(stem, runId);
    },
    [sample.stem, run, saving, confirmDiscard, onSelect]
  );

  /** Moves to another sample, staying on the same batch when the view page can tell. */
  const selectSample = useCallback(
    (next: SampleSummary) => {
      const batch = run?.source?.batch;
      const match = batch === undefined ? null : next.runs.find((r) => r.source?.batch === batch);
      select(next.stem, match?.id ?? null);
    },
    [run, select]
  );

  const cancel = useCallback(() => {
    setEdited(null);
    setActionError(null);
  }, []);

  const judge = useCallback(() => {
    if (!canSave || !run || !verdict) return;
    setSaving(true);
    setActionError(null);
    saveJudgement(run.id, {
      rubricVersion: RUBRIC_VERSION,
      verdict,
      reason: reason.trim(),
      judgedAt: new Date().toISOString()
    })
      .then(
        (judgement) => {
          onPatch(run.id, { judgement });
          setEdited(null);
        },
        (e: unknown) => setActionError(errorMessage(e))
      )
      .finally(() => setSaving(false));
  }, [run, canSave, verdict, reason, onPatch]);

  const nextPending = useCallback(() => {
    const pairs = sampleRuns(samples);
    const index = pairs.findIndex((pair) => pair.run.id === run?.id);
    const next = [...pairs.slice(index + 1), ...pairs.slice(0, index + 1)].find((pair) =>
      isPending(pair.sample, pair.run)
    );
    if (next) select(next.sample.stem, next.run.id);
  }, [samples, run, select]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [role=dialog], [role=radiogroup]")
      )
        return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const index = samples.findIndex(({ stem }) => stem === sample.stem);
        const next = samples[event.key === "ArrowDown" ? index + 1 : index - 1];
        if (next) {
          event.preventDefault();
          selectSample(next);
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const index = runs.findIndex(({ id }) => id === run?.id);
        const next = runs[event.key === "ArrowRight" ? index + 1 : index - 1];
        if (next) {
          event.preventDefault();
          select(sample.stem, next.id);
        }
        return;
      }
      if (mode === "judge" && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        nextPending();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [samples, sample, run, runs, mode, select, selectSample, nextPending]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <Frame
      samples={samples}
      scores={scores}
      empty={empty}
      selected={sample.stem}
      mode={mode}
      loading={loading || saving}
      onSelect={(stem) => {
        const next = samples.find((s) => s.stem === stem);
        if (next) selectSample(next);
      }}
      onMode={(next) => {
        if (!saving && confirmDiscard()) onMode(next);
      }}
      onRefresh={() => {
        if (!saving && confirmDiscard()) {
          cancel();
          void onRefresh();
        }
      }}
    >
      <SampleView
        sample={sample}
        run={run}
        runs={runs}
        mode={mode}
        dirty={dirty}
        selectedRender={selectedRender}
        onSelectRun={(id) => select(sample.stem, id)}
        onSelectRender={setSelectedRender}
        error={actionError}
      >
        {mode === "judge" ? (
          <JudgingPanel
            sample={sample}
            run={run}
            verdict={verdict}
            reason={reason}
            dirty={dirty}
            busy={saving}
            canSave={canSave}
            viewingSubmission={viewingSubmission}
            onVerdict={(value) => setEdited({ verdict: value, reason })}
            onReason={(value) => setEdited({ verdict, reason: value })}
            onSave={judge}
            onCancel={cancel}
          />
        ) : (
          <DetailsPanel run={run} />
        )}
      </SampleView>
    </Frame>
  );
}

interface FrameProps {
  samples: SampleSummary[];
  scores: ScoreLine[];
  empty: string;
  selected: string | null;
  mode: Mode;
  loading: boolean;
  onSelect: (stem: string) => void;
  onMode: (mode: Mode) => void;
  onRefresh: () => void;
  children: ReactNode;
}

function Frame({
  samples,
  scores,
  empty,
  selected,
  mode,
  loading,
  onSelect,
  onMode,
  onRefresh,
  children
}: FrameProps) {
  return (
    <Grid columns="280px auto 1fr" height="100vh">
      <Sidebar
        samples={samples}
        scores={scores}
        empty={empty}
        selected={selected}
        mode={mode}
        loading={loading}
        onSelect={onSelect}
        onMode={onMode}
        onRefresh={onRefresh}
      />
      <Separator orientation="vertical" size="4" />
      {children}
    </Grid>
  );
}
