import { Button, Flex, Kbd, Text, TextArea, Heading } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import type { Verdict } from "../shared/judge.ts";
import { hasSubmission, type Run, type SampleSummary } from "../shared/types.ts";
import { isJudgeable } from "./sample.ts";

const VERDICTS = [
  ["pass", "Pass", "green", "p"],
  ["fail", "Fail", "red", "f"],
  ["needs_review", "Needs review", "orange", "n"]
] as const;

export interface LiveJudgement {
  reason: string;
  verdict: Verdict | null;
  dirty: boolean;
  canSave: boolean;
}

interface Props {
  sample: SampleSummary;
  run: Run | null;
  verdict: Verdict | null;
  reason: string;
  savedVerdict: Verdict | null;
  savedReason: string;
  busy: boolean;
  viewingSubmission: boolean;
  /** Let the saved verdict be saved again unchanged: in Resolve, that is what settles a run. */
  confirmable: boolean;
  onVerdict: (verdict: Verdict) => void;
  onReason: (reason: string) => void;
  onLive: (live: LiveJudgement) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}

export function JudgingPanel({
  sample,
  run,
  verdict,
  reason,
  savedVerdict,
  savedReason,
  busy,
  viewingSubmission,
  confirmable,
  onVerdict,
  onReason,
  onLive,
  onSave,
  onCancel,
  onReset
}: Props) {
  const blocked = !run || !isJudgeable(sample, run) || !viewingSubmission;

  // Committing every keystroke to the parent re-renders the sidebar, upwards of 150ms a
  // character once a few hundred samples are listed; onLive only writes a ref.
  const [draft, setDraft] = useState(reason);
  const [committed, setCommitted] = useState(reason);
  if (committed !== reason) {
    setCommitted(reason);
    setDraft(reason);
  }

  const measure = (text: string, chosen: Verdict | null): LiveJudgement => {
    const dirty = chosen !== savedVerdict || text !== savedReason;
    return {
      reason: text,
      verdict: chosen,
      dirty,
      canSave:
        !busy &&
        !blocked &&
        (dirty || confirmable) &&
        chosen !== null &&
        (chosen !== "fail" || text.trim() !== "")
    };
  };
  const live = measure(draft, verdict);
  const { dirty, canSave } = live;

  // No dependencies: the parent's ref has to track every render.
  useEffect(() => {
    onLive(live);
  });

  return (
    <Flex direction="column" gap="3">
      <Heading size="3">Judgement</Heading>
      <Text size="2">
        The submission must preserve all visible mathematical content and diagrammatic
        relationships. This includes labels, markings, meaningful proportions, and intentional
        blanks. Cosmetic differences are acceptable.
      </Text>
      <Text size="2" weight="bold">
        Inspect in order:
      </Text>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: "var(--font-size-2)" }}>
        <li>Structure, relationships, and meaningful proportions</li>
        <li>Every label, number, and symbol</li>
        <li>Arrows, ticks, endpoints, shading, and blanks</li>
        <li>Missing or unwanted content</li>
      </ol>
      <Blocker sample={sample} run={run} viewingSubmission={viewingSubmission} />
      <Flex gap="2" wrap="wrap">
        {VERDICTS.map(([value, label, color, key]) => (
          <Button
            key={value}
            size="2"
            color={color}
            variant={verdict === value ? "solid" : "soft"}
            disabled={busy || blocked}
            onClick={() => onVerdict(value)}
          >
            {label}
            <Kbd size="1">{key}</Kbd>
          </Button>
        ))}
      </Flex>
      <Text as="label" size="2" htmlFor="judgement-reason">
        {verdict === "fail" ? "Failure reason (required)" : "Review note (optional)"}
      </Text>
      <TextArea
        id="judgement-reason"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          // Written before the state update so a save keyed immediately after a keystroke sees it.
          onLive(measure(next, verdict));
          setDraft(next);
        }}
        onBlur={() => {
          if (draft !== reason) onReason(draft);
        }}
        disabled={busy || blocked}
        rows={3}
      />
      <Flex gap="2">
        <Button onClick={onSave} disabled={!canSave}>
          {busy ? "Saving…" : dirty || !confirmable ? "Save judgement" : "Confirm judgement"}
          <Kbd size="1">↵</Kbd>
        </Button>
        <Button variant="soft" onClick={onCancel} disabled={busy || !dirty}>
          Cancel
          <Kbd size="1">esc</Kbd>
        </Button>
        {savedVerdict && (
          <Button variant="soft" color="gray" onClick={onReset} disabled={busy}>
            Reset
            <Kbd size="1">r</Kbd>
          </Button>
        )}
      </Flex>
      {savedVerdict && !dirty && (
        <Text size="1" color="gray">
          Saved: {savedVerdict.replaceAll("_", " ")}
        </Text>
      )}
      <Text size="1" color="gray">
        <Kbd>space</Kbd>/<Kbd>shift space</Kbd> next/previous pending <Kbd>↑</Kbd>/<Kbd>↓</Kbd>{" "}
        samples <Kbd>←</Kbd>/<Kbd>→</Kbd> runs <Kbd>ctrl ↵</Kbd> saves while writing a reason
      </Text>
    </Flex>
  );
}

function Blocker({
  sample,
  run,
  viewingSubmission
}: {
  sample: SampleSummary;
  run: Run | null;
  viewingSubmission: boolean;
}) {
  if (!run) {
    return (
      <Text size="2" color="gray">
        No run for this sample.
      </Text>
    );
  }
  if (!run.result) {
    return (
      <Text size="2" color="gray">
        Run in progress. Judge after it finishes.
      </Text>
    );
  }
  if (!hasSubmission(run)) {
    return (
      <Text size="2" color="red">
        No submitted image. Counted as a failure.
      </Text>
    );
  }
  if (!sample.hasCrop) {
    return (
      <Text size="2" color="gray">
        A reference crop is required to judge this submission.
      </Text>
    );
  }
  if (!viewingSubmission) {
    return (
      <Text size="2" color="orange">
        Return to the submitted image to record a judgement.
      </Text>
    );
  }
  return null;
}
