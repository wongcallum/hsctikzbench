import { Callout, DataList, Flex, Grid, Separator, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RUBRIC_VERSION, type Verdict } from "../shared/judge.ts";
import type { Run, SampleSummary, UserRole } from "../shared/types.ts";
import { clearJudgement, fetchSamples, saveJudgement } from "./api.ts";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { JudgingPanel, type LiveJudgement } from "./JudgingPanel.tsx";
import { setLeaveGuard, type JudgeLocation, type Mode } from "./location.ts";
import {
  isDisputed,
  isJudgeable,
  isPending,
  listedRuns,
  listedSamples,
  sampleRuns,
  scoreLines,
  type ScoreLine
} from "./sample.ts";
import { SampleSidebar } from "./SampleSidebar.tsx";
import { SampleView } from "./SampleView.tsx";
import { JudgeVerdicts, ResolutionItem } from "./Verdicts.tsx";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function claimedByGroup(group: Element, key: string): boolean {
  const orientation = group.getAttribute("aria-orientation");
  if (key === "ArrowUp" || key === "ArrowDown") return orientation !== "horizontal";
  if (key === "ArrowLeft" || key === "ArrowRight") return orientation !== "vertical";
  return false;
}

const VERDICT_KEYS: Record<string, Verdict> = {
  p: "pass",
  f: "fail",
  n: "needs_review"
};

interface AppProps {
  location: JudgeLocation;
  setLocation: (next: JudgeLocation) => void;
  role: UserRole;
}

/** Whether the mode hides where runs came from. Judges are blind whatever the mode. */
const isBlind = (mode: Mode) => mode === "judge";

export function JudgeApp({ location, setLocation, role }: AppProps) {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshId = useRef(0);
  const mode = location.mode;

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    setLoading(true);
    try {
      const next = await fetchSamples(isBlind(mode));
      if (id !== refreshId.current) return;
      setSamples(next);
      setError(null);
    } catch (e) {
      if (id !== refreshId.current) return;
      setError(errorMessage(e));
    } finally {
      if (id === refreshId.current) setLoading(false);
    }
  }, [mode]);

  // Drop the previous mode's listing before refetching so the judge page never shows provenance.
  useEffect(() => {
    setSamples([]);
    setError(null);
    void refresh();
  }, [refresh]);

  const listed = useMemo(
    () => listedSamples(samples, mode, location.stem),
    [samples, mode, location.stem]
  );
  // Sidebar is memoised on its props, so this must stay referentially stable.
  const scores = useMemo(() => scoreLines(samples, mode, role), [samples, mode, role]);
  const empty =
    samples.length === 0
      ? "The manifest has no samples."
      : mode === "resolve"
        ? "No disputes to settle."
        : "Nothing left to judge.";
  const sample = listed.find((s) => s.stem === location.stem) ?? listed[0] ?? null;
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
  const selectStem = useCallback((stem: string) => select(stem, null), [select]);
  const refreshFrame = useCallback(() => void refresh(), [refresh]);

  const content = error ? (
    <Flex p="4">
      <Callout.Root color="red">
        <Callout.Text>{error}</Callout.Text>
      </Callout.Root>
    </Flex>
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
      onRefresh={refresh}
      onPatch={patch}
    />
  ) : (
    <Flex p="4">
      <Text color="gray">{loading ? "Loading…" : empty}</Text>
    </Flex>
  );

  if (!error && sample) return content;
  return (
    <Frame
      samples={listed}
      scores={scores}
      empty={empty}
      selected={sample?.stem ?? null}
      mode={mode}
      loading={loading}
      onSelect={selectStem}
      onRefresh={refreshFrame}
    >
      {content}
    </Frame>
  );
}

interface WorkspaceProps {
  sample: SampleSummary;
  run: Run | null;
  runs: Run[];
  samples: SampleSummary[];
  scores: ScoreLine[];
  empty: string;
  mode: Mode;
  loading: boolean;
  onSelect: (stem: string, runId: string | null) => void;
  onRefresh: () => Promise<void>;
  onPatch: (runId: string, changes: Partial<Run>) => void;
}

interface EditorState {
  selection: string;
  session: symbol;
  selectedRender: string | null;
  saving: boolean;
  actionError: string | null;
  edited: { verdict: Verdict | null; reason: string } | null;
}

const freshEditor = (selection: string): EditorState => ({
  selection,
  session: Symbol(),
  selectedRender: null,
  saving: false,
  actionError: null,
  edited: null
});

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
  onRefresh,
  onPatch
}: WorkspaceProps) {
  const selection = `${mode}/${run?.id ?? sample.stem}`;
  const saved = run?.judgement ?? null;
  const savedVerdict = saved?.verdict ?? null;
  const savedReason = saved?.reason ?? "";
  const restingLive = (): LiveJudgement => ({
    reason: savedReason,
    verdict: savedVerdict,
    dirty: false,
    canSave: false
  });

  const [editor, setEditor] = useState(() => freshEditor(selection));
  // The reason reaches here through a ref rather than state, so a keystroke never re-renders
  // the sidebar. Saving and the leave guard read the ref.
  const live = useRef<LiveJudgement>(restingLive());
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);

  // Reset before rendering children while keeping the frame and sidebar mounted.
  if (editor.selection !== selection) {
    setEditor(freshEditor(selection));
    live.current = restingLive();
    dirtyRef.current = false;
    setDirty(false);
  }
  const { session, selectedRender, saving, actionError, edited } = editor;
  // Ignore saves that finish after navigating away, even if this sample is revisited.
  const updateEditor = useCallback(
    (changes: Partial<Omit<EditorState, "selection" | "session">>) =>
      setEditor((current) => (current.session === session ? { ...current, ...changes } : current)),
    [session]
  );

  const verdict = edited?.verdict ?? savedVerdict;
  const reason = edited?.reason ?? savedReason;
  const viewingSubmission = selectedRender === null || selectedRender === run?.renders.at(-1);
  const canJudge = !saving && run !== null && isJudgeable(sample, run) && viewingSubmission;
  const blind = isBlind(mode);

  const onLive = useCallback((next: LiveJudgement) => {
    live.current = next;
    dirtyRef.current = next.dirty;
    setDirty(next.dirty);
  }, []);

  const commitReason = useCallback(
    (value: string) => updateEditor({ edited: { verdict: live.current.verdict, reason: value } }),
    [updateEditor]
  );

  const confirmDiscard = useCallback(
    () => !dirtyRef.current || window.confirm("Discard the unsaved judgement?"),
    []
  );
  useEffect(() => {
    setLeaveGuard(confirmDiscard);
    return () => setLeaveGuard(null);
  }, [confirmDiscard]);

  const select = useCallback(
    (stem: string, runId: string | null) => {
      if (saving) return;
      if (stem === sample.stem && runId === (run?.id ?? null)) return;
      if (confirmDiscard()) onSelect(stem, runId);
    },
    [sample.stem, run, saving, confirmDiscard, onSelect]
  );

  const selectSample = useCallback(
    (next: SampleSummary) => {
      const batch = run?.source?.batch;
      const match = batch === undefined ? null : next.runs.find((r) => r.source?.batch === batch);
      select(next.stem, match?.id ?? null);
    },
    [run, select]
  );

  const setVerdict = useCallback(
    (value: Verdict) => {
      if (canJudge) updateEditor({ edited: { verdict: value, reason: live.current.reason } });
    },
    [canJudge, updateEditor]
  );

  const cancel = useCallback(() => {
    updateEditor({ edited: null, actionError: null });
  }, [updateEditor]);

  const judge = useCallback(() => {
    const { reason: typed, verdict: chosen, canSave } = live.current;
    if (!canSave || !run || !chosen) return;
    // Blocks a second save keyed before the saving flag has made it back down to the panel.
    live.current = { ...live.current, canSave: false };
    updateEditor({ saving: true, actionError: null });
    saveJudgement(
      run.id,
      { rubricVersion: RUBRIC_VERSION, verdict: chosen, reason: typed.trim() },
      blind
    )
      .then(
        (saved) => {
          onPatch(run.id, saved);
          updateEditor({ edited: null });
        },
        (e: unknown) => updateEditor({ actionError: errorMessage(e) })
      )
      .finally(() => updateEditor({ saving: false }));
  }, [run, blind, onPatch, updateEditor]);

  const reset = useCallback(() => {
    if (saving || !run?.judgement) return;
    if (!window.confirm("Reset the saved judgement for this run?")) return;
    updateEditor({ saving: true, actionError: null });
    clearJudgement(run.id, blind)
      .then(
        (cleared) => {
          onPatch(run.id, cleared);
          updateEditor({ edited: null });
        },
        (e: unknown) => updateEditor({ actionError: errorMessage(e) })
      )
      .finally(() => updateEditor({ saving: false }));
  }, [run, saving, blind, onPatch, updateEditor]);

  // Space seeks the next run needing this mode's attention: unjudged when judging, disputed
  // when resolving.
  const seekPending = useCallback(
    (step: 1 | -1) => {
      const pairs = sampleRuns(samples);
      const index = pairs.findIndex((pair) => pair.run.id === run?.id);
      const rotate = (at: number) => [...pairs.slice(at), ...pairs.slice(0, at)];
      const order = step === 1 ? rotate(index + 1) : rotate(Math.max(index, 0)).reverse();
      const wanted = mode === "resolve" ? isDisputed : isPending;
      const next = order.find((pair) => wanted(pair.sample, pair.run));
      if (next) select(next.sample.stem, next.run.id);
    },
    [samples, run, mode, select]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[role=dialog]")) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        judge();
        return;
      }
      if (target?.closest("input, textarea")) {
        // Escape leaves the reason field; pressing it again then discards the edit.
        if (event.key === "Escape") target.blur();
        return;
      }
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
      if (mode === "view") return;
      if (event.key === " ") {
        event.preventDefault();
        seekPending(event.shiftKey ? -1 : 1);
        return;
      }
      const keyed = VERDICT_KEYS[event.key.toLowerCase()];
      if (keyed) {
        event.preventDefault();
        setVerdict(keyed);
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        reset();
        return;
      }
      if (event.key === "Enter") {
        const pressable = target?.closest("a[href], button:not([role=radio])");
        if (pressable?.matches(":focus-visible")) return;
        event.preventDefault();
        judge();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    samples,
    sample,
    run,
    runs,
    mode,
    select,
    selectSample,
    seekPending,
    setVerdict,
    judge,
    reset,
    cancel
  ]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const selectFromSidebar = useCallback(
    (stem: string) => {
      const next = samples.find((s) => s.stem === stem);
      if (next) selectSample(next);
    },
    [samples, selectSample]
  );

  const refreshFromSidebar = useCallback(() => {
    if (!saving && confirmDiscard()) {
      cancel();
      void onRefresh();
    }
  }, [saving, confirmDiscard, cancel, onRefresh]);

  return (
    <Frame
      samples={samples}
      scores={scores}
      empty={empty}
      selected={sample.stem}
      mode={mode}
      loading={loading || saving}
      onSelect={selectFromSidebar}
      onRefresh={refreshFromSidebar}
    >
      <SampleView
        key={selection}
        sample={sample}
        run={run}
        runs={runs}
        dirty={dirty}
        selectedRender={selectedRender}
        onSelectRun={(id) => select(sample.stem, id)}
        onSelectRender={(selectedRender) => updateEditor({ selectedRender })}
        error={actionError}
        own={mode === "judge"}
        panelWidth={mode === "judge" ? "360px" : "clamp(360px, 30%, 480px)"}
      >
        {mode === "view" ? (
          <DetailsPanel run={run} busy={saving} onReset={reset} />
        ) : (
          <Flex direction="column" gap="4">
            {mode === "resolve" && run && <Dispute run={run} />}
            <JudgingPanel
              sample={sample}
              run={run}
              verdict={verdict}
              reason={reason}
              savedVerdict={savedVerdict}
              savedReason={savedReason}
              busy={saving}
              viewingSubmission={viewingSubmission}
              confirmable={mode === "resolve" && run?.resolution?.verdict === "disputed"}
              onVerdict={setVerdict}
              onReason={commitReason}
              onLive={onLive}
              onSave={judge}
              onCancel={cancel}
              onReset={reset}
            />
          </Flex>
        )}
      </SampleView>
    </Frame>
  );
}

/** What the owner needs to settle a run: where it came from and what each judge said. */
function Dispute({ run }: { run: Run }) {
  const model = run.source?.model;
  return (
    <Flex direction="column" gap="3">
      <DataList.Root size="2">
        {run.source && (
          <DataList.Item>
            <DataList.Label minWidth="80px">Batch</DataList.Label>
            <DataList.Value>{run.source.batch}</DataList.Value>
          </DataList.Item>
        )}
        {model && (
          <DataList.Item>
            <DataList.Label minWidth="80px">Model</DataList.Label>
            <DataList.Value>
              {model.provider}/{model.model} · {model.reasoning}
            </DataList.Value>
          </DataList.Item>
        )}
        <ResolutionItem run={run} />
      </DataList.Root>
      <JudgeVerdicts run={run} />
      <Text size="2" color="gray">
        Saving here settles the run, until a judge disagrees after you. Judges are not shown each
        other's verdicts or yours.
      </Text>
    </Flex>
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
  onRefresh,
  children
}: FrameProps) {
  return (
    <Grid columns="280px auto 1fr" height="100%">
      <SampleSidebar
        samples={samples}
        scores={scores}
        empty={empty}
        selected={selected}
        mode={mode}
        loading={loading}
        onSelect={onSelect}
        onRefresh={onRefresh}
      />
      <Separator orientation="vertical" size="4" />
      {children}
    </Grid>
  );
}
