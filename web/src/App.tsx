import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
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
  const [selectedRender, setSelectedRender] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const selected = samples.find((s) => s.stem === hash) ?? samples[0] ?? null;
  const savedText = toText(selected?.checklist ?? null);
  const text = edited ?? savedText;
  const dirty = text !== savedText;

  useEffect(() => {
    if (selected && selected.stem !== hash) setHash(selected.stem);
  }, [selected, hash, setHash]);

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard unsaved changes to this checklist?"),
    [dirty]
  );

  const select = useCallback(
    (stem: string) => {
      if (stem === selected?.stem || busy !== null || !confirmDiscard()) return;
      setEdited(null);
      setSelectedRender(null);
      setActionError(null);
      setHash(stem);
    },
    [selected, busy, confirmDiscard, setHash]
  );

  const patch = useCallback(
    (stem: string, changes: Partial<SampleSummary>) =>
      setSamples((ss) => ss.map((s) => (s.stem === stem ? { ...s, ...changes } : s))),
    []
  );

  /** Runs a checklist action, disabling the editor until it settles. */
  const perform = useCallback(<T,>(kind: Busy, task: Promise<T>, then: (value: T) => void) => {
    setBusy(kind);
    setActionError(null);
    task.then(then, (e: unknown) => setActionError(errorMessage(e))).finally(() => setBusy(null));
  }, []);

  const draft = useCallback(() => {
    if (!selected || busy !== null || !confirmDiscard()) return;
    perform("drafting", draftChecklist(selected.stem), (items) => setEdited(toText(items)));
  }, [selected, busy, confirmDiscard, perform]);

  const save = useCallback(() => {
    if (!selected || busy !== null || !dirty) return;
    const { stem } = selected;
    const items = fromText(text);
    perform("saving", saveChecklist(stem, items), () => {
      patch(stem, { checklist: items });
      setEdited(null);
    });
  }, [selected, busy, dirty, text, perform, patch]);

  const cancel = useCallback(() => {
    setEdited(null);
    setActionError(null);
  }, []);

  /** Records a judgement optimistically and reports any save failure. */
  const judge = useCallback(
    (sample: SampleSummary, judgement: Judgement) => {
      if (!sample.run) return;
      patch(sample.stem, { run: { ...sample.run, judgement } });
      saveJudgement(sample.stem, judgement).then(
        () => setActionError(null),
        (e: unknown) => setActionError(errorMessage(e))
      );
    },
    [patch]
  );

  // Sets item `index` to `wanted`, or clears it when it is already `wanted`
  const toggleItem = useCallback(
    (index: number, wanted: boolean) => {
      const run = selected?.run;
      if (!selected || !run || !hasSubmission(run) || selected.checklist === null) return;
      const items = mergeItems(selected.checklist, run.judgement);
      const item = items[index];
      if (item) judge(selected, withItem(items, index, item.pass === wanted ? null : wanted));
    },
    [selected, judge]
  );

  const recordNoSubmission = useCallback(() => {
    if (selected?.run && !hasSubmission(selected.run)) judge(selected, noSubmission());
  }, [selected, judge]);

  const nextPending = useCallback(() => {
    const i = samples.findIndex((s) => s.stem === selected?.stem);
    const next = [...samples.slice(i + 1), ...samples.slice(0, i + 1)].find(isPending);
    if (next) select(next.stem);
  }, [samples, selected, select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, [role=dialog], [role=radiogroup]")
      )
        return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const i = samples.findIndex((s) => s.stem === selected?.stem);
        const next = samples[e.key === "ArrowDown" ? i + 1 : i - 1];
        if (next) {
          e.preventDefault();
          select(next.stem);
        }
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        nextPending();
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        toggleItem(Number(digit[1]) - 1, !e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [samples, selected, select, toggleItem, nextPending]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <Theme accentColor="gray" grayColor="slate">
      <Grid columns="280px auto 1fr" height="100vh">
        <Sidebar
          samples={samples}
          selected={selected?.stem ?? null}
          loading={loading}
          onSelect={select}
          onRefresh={() => {
            if (confirmDiscard()) {
              setEdited(null);
              void refresh();
            }
          }}
        />
        <Separator orientation="vertical" size="4" />
        {error ? (
          <Flex p="4">
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          </Flex>
        ) : selected ? (
          <SampleView
            key={selected.stem}
            sample={selected}
            dirty={dirty}
            selectedRender={selectedRender}
            onSelectRender={setSelectedRender}
            error={actionError}
          >
            <ChecklistEditor
              sample={selected}
              text={text}
              dirty={dirty}
              busy={busy}
              canDraft={canDraft}
              onChange={setEdited}
              onDraft={draft}
              onSave={save}
              onCancel={cancel}
            />
            <JudgingPanel
              sample={selected}
              onToggleItem={toggleItem}
              onNoSubmission={recordNoSubmission}
            />
          </SampleView>
        ) : (
          <Flex p="4">
            <Text color="gray">{loading ? "Loading…" : "The manifest has no samples."}</Text>
          </Flex>
        )}
      </Grid>
    </Theme>
  );
}
