import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { draftChecklist, fetchSamples, saveChecklist } from "./api.ts";
import { fromText, isApproved, toText } from "./checklist.ts";
import { SampleView } from "./SampleView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import type { SampleSummary } from "./types.ts";
import { useHash } from "./useHash.ts";

export function App() {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useHash();
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState<"drafting" | "saving" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSamples(await fetchSamples());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setActionError(null);
      setHash(stem);
    },
    [selected, busy, confirmDiscard, setHash]
  );

  const draft = useCallback(() => {
    if (!selected || busy !== null || !confirmDiscard()) return;
    const stem = selected.stem;
    setBusy("drafting");
    setActionError(null);
    draftChecklist(stem).then(
      (items) => {
        setEdited(toText(items));
        setBusy(null);
      },
      (e: unknown) => {
        setActionError(e instanceof Error ? e.message : String(e));
        setBusy(null);
      }
    );
  }, [selected, busy, confirmDiscard]);

  const save = useCallback(() => {
    if (!selected || busy !== null || !dirty) return;
    const stem = selected.stem;
    const items = fromText(text);
    setBusy("saving");
    setActionError(null);
    saveChecklist(stem, items).then(
      () => {
        setSamples((ss) => ss.map((s) => (s.stem === stem ? { ...s, checklist: items } : s)));
        setEdited(null);
        setBusy(null);
      },
      (e: unknown) => {
        setActionError(e instanceof Error ? e.message : String(e));
        setBusy(null);
      }
    );
  }, [selected, busy, dirty, text]);

  const cancel = useCallback(() => {
    setEdited(null);
    setActionError(null);
  }, []);

  const nextUnapproved = useCallback(() => {
    const i = samples.findIndex((s) => s.stem === selected?.stem);
    const next = [...samples.slice(i + 1), ...samples.slice(0, i + 1)].find((s) => !isApproved(s));
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
        nextUnapproved();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [samples, selected, select, nextUnapproved]);

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
            text={text}
            dirty={dirty}
            busy={busy}
            error={actionError}
            onChange={setEdited}
            onDraft={draft}
            onSave={save}
            onCancel={cancel}
          />
        ) : (
          <Flex p="4">
            <Text color="gray">{loading ? "Loading…" : "The manifest has no samples."}</Text>
          </Flex>
        )}
      </Grid>
    </Theme>
  );
}
