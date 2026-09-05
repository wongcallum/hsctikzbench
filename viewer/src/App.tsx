import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { fetchRuns, saveJudgement } from "./api.ts";
import { hasSubmission, mergeItems, needsJudging, noSubmission, withItem } from "./judging.ts";
import { RunView } from "./RunView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import type { Judgement, RunSummary } from "./types.ts";
import { useHash } from "./useHash.ts";

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hash, setHash] = useHash();
  const [selectedRender, setSelectedRender] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await fetchRuns());
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

  const selected = runs.find((r) => r.name === hash) ?? runs[0] ?? null;

  useEffect(() => {
    if (selected && selected.name !== hash) setHash(selected.name);
  }, [selected, hash, setHash]);

  const select = useCallback(
    (name: string) => {
      setSelectedRender(null);
      setHash(name);
    },
    [setHash]
  );

  const judge = useCallback((name: string, judgement: Judgement) => {
    setRuns((rs) => rs.map((r) => (r.name === name ? { ...r, judgement } : r)));
    saveJudgement(name, judgement).then(
      () => setSaveError(null),
      (e: unknown) => setSaveError(e instanceof Error ? e.message : String(e))
    );
  }, []);

  // Sets item `index` to `wanted`, or clears it when it is already `wanted`
  const toggleItem = useCallback(
    (index: number, wanted: boolean) => {
      if (!selected || !hasSubmission(selected) || selected.checklist === null) return;
      const items = mergeItems(selected.checklist, selected.judgement);
      const item = items[index];
      if (!item) return;
      judge(selected.name, withItem(items, index, item.pass === wanted ? null : wanted));
    },
    [selected, judge]
  );

  const recordNoSubmission = useCallback(() => {
    if (!selected || hasSubmission(selected)) return;
    judge(selected.name, noSubmission());
  }, [selected, judge]);

  const nextNeedingJudging = useCallback(() => {
    const i = runs.findIndex((r) => r.name === selected?.name);
    const next = [...runs.slice(i + 1), ...runs.slice(0, i + 1)].find(needsJudging);
    if (next) select(next.name);
  }, [runs, selected, select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, [role=dialog], [role=radiogroup]")
      )
        return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const i = runs.findIndex((r) => r.name === selected?.name);
        const next = runs[e.key === "ArrowDown" ? i + 1 : i - 1];
        if (next) {
          e.preventDefault();
          select(next.name);
        }
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        nextNeedingJudging();
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
  }, [runs, selected, select, toggleItem, nextNeedingJudging]);

  return (
    <Theme accentColor="gray" grayColor="slate">
      <Grid columns="280px auto 1fr" height="100vh">
        <Sidebar
          runs={runs}
          selected={selected?.name ?? null}
          loading={loading}
          onSelect={select}
          onRefresh={() => void refresh()}
        />
        <Separator orientation="vertical" size="4" />
        {error ? (
          <Flex p="4">
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          </Flex>
        ) : selected ? (
          <RunView
            key={selected.name}
            run={selected}
            selectedRender={selectedRender}
            saveError={saveError}
            onSelectRender={setSelectedRender}
            onToggleItem={toggleItem}
            onNoSubmission={recordNoSubmission}
          />
        ) : (
          <Flex p="4">
            <Text color="gray">{loading ? "Loading…" : "Put runs in data/runs/<name>/."}</Text>
          </Flex>
        )}
      </Grid>
    </Theme>
  );
}
