import { Badge, Button, Flex, Grid, Heading, Kbd, Text, TextArea } from "@radix-ui/themes";
import { cropUrl } from "./api.ts";
import { fromText, isApproved, label } from "./checklist.ts";
import { ImagePane } from "./ImagePane.tsx";
import type { SampleSummary } from "./types.ts";

interface Props {
  sample: SampleSummary;
  text: string;
  dirty: boolean;
  busy: "drafting" | "saving" | null;
  error: string | null;
  onChange: (text: string) => void;
  onDraft: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function SampleView({
  sample,
  text,
  dirty,
  busy,
  error,
  onChange,
  onDraft,
  onSave,
  onCancel
}: Props) {
  const count = fromText(text)?.length ?? 0;
  return (
    <Flex direction="column" minHeight="0" minWidth="0">
      <Flex align="center" gap="2" p="4" pb="2" wrap="wrap">
        <Heading size="3">{label(sample)}</Heading>
        <Text size="1" color="gray">
          {sample.stem}
        </Text>
        <Badge color="gray" variant="outline" size="1">
          {sample.category.replaceAll("_", " ")}
        </Badge>
        <Badge color="gray" variant="outline" size="1">
          {sample.role.replaceAll("_", " ")}
        </Badge>
        {isApproved(sample) && (
          <Badge color="green" variant="soft" size="1">
            approved
          </Badge>
        )}
        {dirty && (
          <Badge color="orange" variant="soft" size="1">
            unsaved
          </Badge>
        )}
      </Flex>
      <Grid columns="1fr 1fr" gap="4" p="4" pt="2" flexGrow="1" minHeight="0">
        <ImagePane
          label="Reference"
          src={sample.hasCrop ? cropUrl(sample.stem) : null}
          emptyText="No crop; run dataset build."
        />
        <Flex direction="column" gap="2" minHeight="0">
          <Flex align="baseline" gap="2">
            <Text size="2" weight="bold">
              Checklist
            </Text>
            <Text size="1" color="gray">
              one item per line · {count} {count === 1 ? "item" : "items"}
            </Text>
          </Flex>
          <TextArea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy !== null}
            style={{ flexGrow: 1, minHeight: 0 }}
            placeholder="No checklist. Draft one or write items here."
          />
          <Flex gap="2" align="center">
            <Button
              size="2"
              variant="soft"
              onClick={onDraft}
              disabled={busy !== null || !sample.hasCrop}
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
          {error && (
            <Text size="1" color="red" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Text>
          )}
          <Text size="1" color="gray">
            Draft replaces the editor with a fresh model draft. Saving an empty editor removes the
            checklist. <Kbd size="1">n</Kbd> next sample without a checklist.
          </Text>
        </Flex>
      </Grid>
    </Flex>
  );
}
