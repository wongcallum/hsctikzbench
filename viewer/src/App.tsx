import { Callout, Flex, Grid, Separator, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { fetchRuns } from "./api.ts";
import { RunView } from "./RunView.tsx";
import { Sidebar } from "./Sidebar.tsx";
import type { RunSummary } from "./types.ts";
import { useHash } from "./useHash.ts";

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, [role=dialog], [role=radiogroup]")
      )
        return;
      const i = runs.findIndex((r) => r.name === selected?.name);
      const next = runs[e.key === "ArrowDown" ? i + 1 : i - 1];
      if (next) {
        e.preventDefault();
        select(next.name);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runs, selected, select]);

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
            onSelectRender={setSelectedRender}
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
