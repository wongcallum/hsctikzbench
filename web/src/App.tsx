import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchSamples, saveJudgement } from "./api.ts";
import { JudgingPanel } from "./JudgingPanel.tsx";
import { isJudgeable, isPending } from "./sample.ts";
import { SampleView } from "./SampleView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { RUBRIC_VERSION, type SampleSummary, type Verdict } from "./types.ts";
import { useHash } from "./useHash.ts";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useHash();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSamples(await fetchSamples());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = samples.find((sample) => sample.stem === hash) ?? samples[0] ?? null;

  useEffect(() => {
    if (selected && selected.stem !== hash) setHash(selected.stem);
  }, [selected, hash, setHash]);

  const patch = useCallback(
    (stem: string, changes: Partial<SampleSummary>) =>
      setSamples((current) =>
        current.map((sample) => (sample.stem === stem ? { ...sample, ...changes } : sample))
      ),
    []
  );

  return (
    <Theme accentColor="gray" grayColor="slate">
      {error ? (
        <Frame
          samples={samples}
          selected={selected?.stem ?? null}
          loading={loading}
          onSelect={setHash}
          onRefresh={() => void refresh()}
        >
          <Flex p="4">
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          </Flex>
        </Frame>
      ) : selected ? (
        <Workspace
          key={selected.stem}
          sample={selected}
          samples={samples}
          loading={loading}
          onSelect={setHash}
          onRefresh={refresh}
          onPatch={patch}
        />
      ) : (
        <Frame
          samples={samples}
          selected={null}
          loading={loading}
          onSelect={setHash}
          onRefresh={() => void refresh()}
        >
          <Flex p="4">
            <Text color="gray">{loading ? "Loading…" : "The manifest has no samples."}</Text>
          </Flex>
        </Frame>
      )}
    </Theme>
  );
}

interface WorkspaceProps {
  sample: SampleSummary;
  samples: SampleSummary[];
  loading: boolean;
  onSelect: (stem: string) => void;
  onRefresh: () => Promise<void>;
  onPatch: (stem: string, changes: Partial<SampleSummary>) => void;
}

function Workspace({ sample, samples, loading, onSelect, onRefresh, onPatch }: WorkspaceProps) {
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [edited, setEdited] = useState<{ verdict: Verdict | null; reason: string } | null>(null);

  const saved = sample.run?.judgement ?? null;
  const verdict = edited?.verdict ?? saved?.verdict ?? null;
  const reason = edited?.reason ?? saved?.reason ?? "";
  const dirty = verdict !== (saved?.verdict ?? null) || reason !== (saved?.reason ?? "");
  const viewingSubmission =
    selectedRender === null || selectedRender === sample.run?.renders.at(-1);
  const canSave =
    !saving &&
    dirty &&
    verdict !== null &&
    (verdict !== "fail" || reason.trim() !== "") &&
    isJudgeable(sample) &&
    viewingSubmission;

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard the unsaved judgement?"),
    [dirty]
  );

  const select = useCallback(
    (stem: string) => {
      if (stem !== sample.stem && !saving && confirmDiscard()) onSelect(stem);
    },
    [sample.stem, saving, confirmDiscard, onSelect]
  );

  const cancel = useCallback(() => {
    setEdited(null);
    setActionError(null);
  }, []);

  const judge = useCallback(() => {
    const run = sample.run;
    if (!canSave || !run || !verdict) return;
    setSaving(true);
    setActionError(null);
    saveJudgement(sample.stem, {
      rubricVersion: RUBRIC_VERSION,
      verdict,
      reason: reason.trim(),
      judgedAt: new Date().toISOString()
    })
      .then(
        (judgement) => {
          onPatch(sample.stem, { run: { ...run, judgement } });
          setEdited(null);
        },
        (e: unknown) => setActionError(errorMessage(e))
      )
      .finally(() => setSaving(false));
  }, [sample, canSave, verdict, reason, onPatch]);

  const nextPending = useCallback(() => {
    const index = samples.findIndex(({ stem }) => stem === sample.stem);
    const next = [...samples.slice(index + 1), ...samples.slice(0, index + 1)].find(isPending);
    if (next) select(next.stem);
  }, [samples, sample.stem, select]);

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
          select(next.stem);
        }
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        nextPending();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [samples, sample.stem, select, nextPending]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <Frame
      samples={samples}
      selected={sample.stem}
      loading={loading || saving}
      onSelect={select}
      onRefresh={() => {
        if (!saving && confirmDiscard()) {
          cancel();
          void onRefresh();
        }
      }}
    >
      <SampleView
        sample={sample}
        dirty={dirty}
        selectedRender={selectedRender}
        onSelectRender={setSelectedRender}
        error={actionError}
      >
        <JudgingPanel
          sample={sample}
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
      </SampleView>
    </Frame>
  );
}

interface FrameProps {
  samples: SampleSummary[];
  selected: string | null;
  loading: boolean;
  onSelect: (stem: string) => void;
  onRefresh: () => void;
  children: ReactNode;
}

function Frame({ samples, selected, loading, onSelect, onRefresh, children }: FrameProps) {
  return (
    <Grid columns="280px auto 1fr" height="100vh">
      <Sidebar
        samples={samples}
        selected={selected}
        loading={loading}
        onSelect={onSelect}
        onRefresh={onRefresh}
      />
      <Separator orientation="vertical" size="4" />
      {children}
    </Grid>
  );
}
