import { Button, Flex, Kbd, Text, TextArea, Heading } from "@radix-ui/themes";
import { hasSubmission, isJudgeable } from "./sample.ts";
import type { Run, SampleSummary, Verdict } from "./types.ts";

const VERDICTS = [
  ["pass", "Pass", "green"],
  ["fail", "Fail", "red"],
  ["needs_review", "Needs review", "orange"]
] as const;

interface Props {
  sample: SampleSummary;
  run: Run | null;
  verdict: Verdict | null;
  reason: string;
  dirty: boolean;
  busy: boolean;
  canSave: boolean;
  viewingSubmission: boolean;
  onVerdict: (verdict: Verdict) => void;
  onReason: (reason: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function JudgingPanel({
  sample,
  run,
  verdict,
  reason,
  dirty,
  busy,
  canSave,
  viewingSubmission,
  onVerdict,
  onReason,
  onSave,
  onCancel
}: Props) {
  const blocked = !run || !isJudgeable(sample, run) || !viewingSubmission;
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
        {VERDICTS.map(([value, label, color]) => (
          <Button
            key={value}
            size="2"
            color={color}
            variant={verdict === value ? "solid" : "soft"}
            disabled={busy || blocked}
            onClick={() => onVerdict(value)}
          >
            {label}
          </Button>
        ))}
      </Flex>
      <Text as="label" size="2" htmlFor="judgement-reason">
        {verdict === "fail" ? "Failure reason (required)" : "Review note (optional)"}
      </Text>
      <TextArea
        id="judgement-reason"
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        disabled={busy || blocked}
        rows={3}
      />
      <Flex gap="2">
        <Button onClick={onSave} disabled={!canSave}>
          {busy ? "Saving…" : "Save judgement"}
        </Button>
        <Button variant="soft" onClick={onCancel} disabled={busy || !dirty}>
          Cancel
        </Button>
      </Flex>
      {run?.judgement && !dirty && (
        <Text size="1" color="gray">
          Saved: {run.judgement.verdict.replaceAll("_", " ")}
        </Text>
      )}
      <Text size="1" color="gray">
        <Kbd>n</Kbd> next pending <Kbd>↑</Kbd>/<Kbd>↓</Kbd> samples <Kbd>←</Kbd>/<Kbd>→</Kbd> runs
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
