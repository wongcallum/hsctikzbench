import { Badge, Callout, Flex, Grid, Heading, Separator, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Choice } from "../shared/compare.ts";
import type { ComparePair, CompareSample, UserRole } from "../shared/types.ts";
import { cropUrl, fetchCompare, recordOutcome, runFileUrl, undoOutcome } from "./api.ts";
import { CompareBadges } from "./badges.tsx";
import { sampleLabel, words } from "./format.ts";
import { KeyHints } from "./hints.tsx";
import { ImagePane } from "./ImagePane.tsx";
import { SampleSidebar } from "./SampleSidebar.tsx";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const CHOICE_KEYS: Record<string, Choice> = {
  ArrowLeft: "left",
  "1": "left",
  ArrowRight: "right",
  "2": "right",
  ArrowDown: "tie",
  "3": "tie"
};

interface Props {
  stem: string | null;
  setStem: (stem: string) => void;
  role: UserRole;
}

const badges = (sample: CompareSample) => <CompareBadges sample={sample} />;

/** Blind pairwise judging: which of two runs is closer to the reference. */
export function CompareApp({ stem, setStem, role }: Props) {
  const [samples, setSamples] = useState<CompareSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const refreshId = useRef(0);
  // Outcomes are applied locally at once and sent one after another, so a quick undo cannot
  // overtake the outcome it undoes.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const queued = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    setLoading(true);
    try {
      const next = await fetchCompare();
      if (id !== refreshId.current) return;
      setSamples(next);
      setError(null);
      setActionError(null);
    } catch (e) {
      if (id !== refreshId.current) return;
      setError(errorMessage(e));
    } finally {
      if (id === refreshId.current) setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  // A sample stays listed while selected, so it does not vanish under the judge on its last pair.
  const listed = useMemo(
    () => samples.filter((s) => s.pending.length > 0 || (s.stem === stem && s.total > 0)),
    [samples, stem]
  );
  const sample = listed.find((s) => s.stem === stem) ?? listed[0] ?? null;
  const pair = sample?.pending[0] ?? null;

  useEffect(() => {
    if (sample && sample.stem !== stem) setStem(sample.stem);
  }, [sample, stem, setStem]);

  const summary = useMemo(() => {
    if (samples.length === 0) return undefined;
    let done = 0;
    let total = 0;
    for (const s of samples) {
      done += s.done;
      total += s.total;
    }
    return `${done} of ${total} pairs judged`;
  }, [samples]);

  const replace = useCallback(
    (next: CompareSample) =>
      setSamples((current) => current.map((s) => (s.stem === next.stem ? next : s))),
    []
  );

  const enqueue = useCallback(
    (work: () => Promise<CompareSample>) => {
      queued.current++;
      queue.current = queue.current.then(work).then(
        (next) => {
          if (--queued.current === 0) replace(next);
        },
        (e: unknown) => {
          queued.current--;
          setActionError(errorMessage(e));
          void refresh();
        }
      );
    },
    [replace, refresh]
  );

  const seek = useCallback(
    (step: 1 | -1, pendingOnly: boolean) => {
      if (!sample) return;
      const index = listed.findIndex((s) => s.stem === sample.stem);
      for (let i = 1; i <= listed.length; i++) {
        const next = listed[(index + step * i + listed.length) % listed.length]!;
        if (!pendingOnly || next.pending.length > 0) {
          if (next.stem !== sample.stem) setStem(next.stem);
          return;
        }
      }
    },
    [sample, listed, setStem]
  );

  const choose = useCallback(
    (choice: Choice) => {
      if (!sample || !pair) return;
      const { stem: current } = sample;
      replace({ ...sample, pending: sample.pending.slice(1), done: sample.done + 1 });
      setActionError(null);
      enqueue(() =>
        recordOutcome(current, { left: pair.left, right: pair.right, outcome: choice })
      );
      if (sample.pending.length === 1) seek(1, true);
    },
    [sample, pair, replace, enqueue, seek]
  );

  const undo = useCallback(() => {
    if (!sample || sample.done === 0) return;
    setActionError(null);
    enqueue(() => undoOutcome(sample.stem));
  }, [sample, enqueue]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[role=dialog], input, textarea")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const choice = CHOICE_KEYS[event.key];
      if (choice) {
        event.preventDefault();
        choose(choice);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        undo();
      } else if (event.key === "PageDown" || event.key === "j") {
        event.preventDefault();
        seek(1, false);
      } else if (event.key === "PageUp" || event.key === "k") {
        event.preventDefault();
        seek(-1, false);
      } else if (event.key === " ") {
        event.preventDefault();
        seek(event.shiftKey ? -1 : 1, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, undo, seek]);

  const refreshFromSidebar = useCallback(() => void refresh(), [refresh]);

  const unassigned = !loading && samples.every((s) => s.total === 0);
  const empty = unassigned
    ? role === "owner"
      ? "No batches are assigned to you. Assign yourself some on the Judges tab."
      : "No batches are assigned to you yet."
    : "Nothing left to compare.";

  return (
    <Grid columns="280px auto 1fr" height="100%">
      <SampleSidebar
        heading="To compare"
        samples={listed}
        summary={summary}
        empty={empty}
        selected={sample?.stem ?? null}
        loading={loading}
        badges={badges}
        onSelect={setStem}
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
        <Comparison sample={sample} pair={pair} error={actionError} />
      ) : (
        <Flex p="4">
          <Text color="gray">{loading ? "Loading…" : empty}</Text>
        </Flex>
      )}
    </Grid>
  );
}

function Comparison({
  sample,
  pair,
  error
}: {
  sample: CompareSample;
  pair: ComparePair | null;
  error: string | null;
}) {
  return (
    <Flex direction="column" minHeight="0" minWidth="0">
      <Flex align="center" gap="2" p="4" pb="2" wrap="wrap">
        <Heading size="3">{sampleLabel(sample)}</Heading>
        <Text size="1" color="gray">
          {sample.stem}
        </Text>
        {sample.category && (
          <Badge color="gray" variant="outline" size="1">
            {words(sample.category)}
          </Badge>
        )}
        {sample.role && (
          <Badge color="gray" variant="outline" size="1">
            {words(sample.role)}
          </Badge>
        )}
        <Text size="1" color="gray" ml="auto">
          pair {Math.min(sample.done + 1, sample.total)} of {sample.total}
        </Text>
      </Flex>
      {error && (
        <Flex px="4">
          <Text size="1" color="red" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </Text>
        </Flex>
      )}
      <Grid rows="1fr 1fr" columns="1fr 1fr" gap="3" px="4" flexGrow="1" minHeight="0">
        <ImagePane
          label="Reference"
          src={sample.hasCrop ? cropUrl(sample.stem) : null}
          emptyText="No crop; run dataset build."
          style={{ gridColumn: "1 / span 2" }}
        />
        <ImagePane
          label="A"
          src={pair ? runFileUrl(pair.left, "submission.png") : null}
          emptyText="No pair left on this sample."
        />
        <ImagePane
          label="B"
          src={pair ? runFileUrl(pair.right, "submission.png") : null}
          emptyText="No pair left on this sample."
        />
      </Grid>
      <Flex align="center" gap="4" p="4" pt="3" wrap="wrap">
        <Text size="2">Which is closer to the reference?</Text>
        <KeyHints
          hints={[
            { keys: ["←"], label: "A" },
            { keys: ["→"], label: "B" },
            { keys: ["↓"], label: "tie" },
            { keys: ["⌫"], label: "undo" },
            { keys: ["j", "k"], label: "samples" },
            { keys: ["space"], label: "next pending" }
          ]}
        />
      </Flex>
    </Flex>
  );
}
