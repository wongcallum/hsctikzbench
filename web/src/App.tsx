import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { draftChecklist, fetchListing, saveChecklist, saveJudgement } from "./api.ts";
import { ChecklistEditor, type Busy } from "./ChecklistEditor.tsx";
import { JudgingPanel } from "./JudgingPanel.tsx";
import {
  fromText,
  hasSubmission,
  isPending,
  mergeItems,
  noSubmission,
  toText,
  withItem
} from "./sample.ts";
import { SampleView } from "./SampleView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import type { Judgement, SampleSummary } from "./types.ts";
import { useHash } from "./useHash.ts";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [canDraft, setCanDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useHash();
  const [editingChecklist, setEditingChecklist] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const listing = await fetchListing();
      setSamples(listing.samples);
      setCanDraft(listing.canDraft);
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
          canDraft={canDraft}
          editingChecklist={editingChecklist}
          onEditingChecklistChange={setEditingChecklist}
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
  canDraft: boolean;
  editingChecklist: boolean;
  onEditingChecklistChange: (editing: boolean) => void;
  loading: boolean;
  onSelect: (stem: string) => void;
  onRefresh: () => Promise<void>;
  onPatch: (stem: string, changes: Partial<SampleSummary>) => void;
}

function Workspace({
  sample,
  samples,
  canDraft,
  editingChecklist,
  onEditingChecklistChange,
  loading,
  onSelect,
  onRefresh,
  onPatch
}: WorkspaceProps) {
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const savedText = toText(sample.checklist);
  const text = edited ?? savedText;
  const dirty = text !== savedText;

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard unsaved changes to this checklist?"),
    [dirty]
  );

  const select = useCallback(
    (stem: string) => {
      if (stem !== sample.stem && busy === null && confirmDiscard()) onSelect(stem);
    },
    [sample.stem, busy, confirmDiscard, onSelect]
  );

  const perform = useCallback(<T,>(kind: Busy, task: Promise<T>, then: (value: T) => void) => {
    setBusy(kind);
    setActionError(null);
    task.then(then, (e: unknown) => setActionError(errorMessage(e))).finally(() => setBusy(null));
  }, []);

  const draft = useCallback(() => {
    if (busy !== null || !confirmDiscard()) return;
    perform("drafting", draftChecklist(sample.stem), (items) => setEdited(toText(items)));
  }, [sample.stem, busy, confirmDiscard, perform]);

  const save = useCallback(() => {
    if (busy !== null || !dirty) return;
    const items = fromText(text);
    perform("saving", saveChecklist(sample.stem, items), () => {
      onPatch(sample.stem, { checklist: items });
      setEdited(null);
    });
  }, [sample.stem, busy, dirty, text, perform, onPatch]);

  const cancel = useCallback(() => {
    setEdited(null);
    setActionError(null);
  }, []);

  const judge = useCallback(
    (judgement: Judgement) => {
      if (!sample.run) return;
      onPatch(sample.stem, { run: { ...sample.run, judgement } });
      saveJudgement(sample.stem, judgement).then(
        () => setActionError(null),
        (e: unknown) => setActionError(errorMessage(e))
      );
    },
    [sample, onPatch]
  );

  const toggleItem = useCallback(
    (index: number, wanted: boolean) => {
      const run = sample.run;
      if (!run || !hasSubmission(run) || sample.checklist === null) return;
      const items = mergeItems(sample.checklist, run.judgement);
      const item = items[index];
      if (item) judge(withItem(items, index, item.pass === wanted ? null : wanted));
    },
    [sample, judge]
  );

  const recordNoSubmission = useCallback(() => {
    if (sample.run && !hasSubmission(sample.run)) judge(noSubmission());
  }, [sample.run, judge]);

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
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit && !editingChecklist) {
        event.preventDefault();
        toggleItem(Number(digit[1]) - 1, !event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [samples, sample.stem, select, toggleItem, nextPending, editingChecklist]);

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
      loading={loading}
      onSelect={select}
      onRefresh={() => {
        if (confirmDiscard()) {
          setEdited(null);
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
        editingChecklist={editingChecklist}
        onEditingChecklistChange={onEditingChecklistChange}
        busy={busy !== null}
      >
        {editingChecklist ? (
          <ChecklistEditor
            sample={sample}
            text={text}
            dirty={dirty}
            busy={busy}
            canDraft={canDraft}
            onChange={setEdited}
            onDraft={draft}
            onSave={save}
            onCancel={cancel}
          />
        ) : (
          <JudgingPanel
            sample={sample}
            onToggleItem={toggleItem}
            onNoSubmission={recordNoSubmission}
          />
        )}
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
