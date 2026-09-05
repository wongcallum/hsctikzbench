import { Button, Flex, Kbd, Text, TextArea } from "@radix-ui/themes";
import { fromText } from "./sample.ts";
import type { SampleSummary } from "./types.ts";

export type Busy = "drafting" | "saving" | null;

interface Props {
  sample: SampleSummary;
  text: string;
  dirty: boolean;
  busy: Busy;
  canDraft: boolean;
  onChange: (text: string) => void;
  onDraft: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ChecklistEditor({
  sample,
  text,
  dirty,
  busy,
  canDraft,
  onChange,
  onDraft,
  onSave,
  onCancel
}: Props) {
  const count = fromText(text)?.length ?? 0;
  return (
    <Flex direction="column" gap="2" flexGrow="1" minHeight="0">
      <Flex align="baseline" gap="2">
        <Text size="2" weight="bold">
          Checklist
        </Text>
        <Text size="1" color="gray">
          one item per line · {count} {count === 1 ? "item" : "items"}
        </Text>
      </Flex>
      <TextArea
        aria-label="Checklist"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy !== null}
        style={{ flex: 1, minHeight: 120 }}
        placeholder="No checklist. Draft one or write items here."
      />
      <Flex gap="2" align="center">
        <Button
          size="2"
          variant="soft"
          onClick={onDraft}
          disabled={busy !== null || !canDraft || !sample.hasCrop}
        >
          {busy === "drafting" ? "Drafting…" : "Draft"}
        </Button>
        <Button size="2" onClick={onSave} disabled={busy !== null || !dirty}>
          {busy === "saving" ? "Saving…" : "Save"}
        </Button>
        <Button
          size="2"
          variant="soft"
          color="gray"
          onClick={onCancel}
          disabled={busy !== null || !dirty}
        >
          Cancel
        </Button>
      </Flex>
      <Text size="1" color="gray">
        Draft replaces the editor with a fresh model draft. Saving an empty editor removes the
        checklist. <Kbd size="1">n</Kbd> next sample needing a checklist or judgement.
      </Text>
    </Flex>
  );
}
