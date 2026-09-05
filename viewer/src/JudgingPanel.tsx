import { Box, Button, Flex, Heading, Kbd, ScrollArea, Text } from "@radix-ui/themes";
import { hasSubmission, judgingState, mergeItems } from "./judging.ts";
import { JudgingBadge } from "./JudgingBadge.tsx";
import type { RunSummary } from "./types.ts";

interface Props {
  run: RunSummary;
  saveError: string | null;
  onToggleItem: (index: number, wanted: boolean) => void;
  onNoSubmission: () => void;
}

export function JudgingPanel({ run, saveError, onToggleItem, onNoSubmission }: Props) {
  return (
    <Flex direction="column" minHeight="0" minWidth="0">
      <Flex align="center" gap="2" p="4" pb="2">
        <Heading size="3">Judgement</Heading>
        <JudgingBadge state={judgingState(run)} />
      </Flex>
      {saveError && (
        <Box mx="4" mb="2">
          <Text size="1" color="red">
            {saveError}
          </Text>
        </Box>
      )}
      <ScrollArea type="auto" scrollbars="vertical">
        <Flex direction="column" gap="3" px="4" pb="4">
          <Body run={run} onToggleItem={onToggleItem} onNoSubmission={onNoSubmission} />
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function Body({ run, onToggleItem, onNoSubmission }: Omit<Props, "saveError">) {
  if (!hasSubmission(run)) {
    return (
      <>
        <Text size="2" color="gray">
          This run has no submission, so it fails as a whole.
        </Text>
        {run.judgement ? (
          <Text size="2">Recorded as no submission.</Text>
        ) : (
          <Button size="2" color="red" variant="soft" onClick={onNoSubmission}>
            Record no submission
          </Button>
        )}
      </>
    );
  }
  if (!run.knownSample) {
    return (
      <Text size="2" color="gray">
        Unknown sample: no manifest entry is named {run.name}.
      </Text>
    );
  }
  if (run.checklist === null) {
    return (
      <Text size="2" color="gray">
        No checklist for this sample.
      </Text>
    );
  }
  const items = mergeItems(run.checklist, run.judgement);
  return (
    <>
      {items.map((item, i) => (
        <Flex key={item.item} direction="column" gap="2">
          <Flex gap="2" align="start">
            <Kbd size="1">{i < 9 ? i + 1 : "·"}</Kbd>
            <Text size="2">{item.item}</Text>
          </Flex>
          <Flex gap="2" pl="6">
            <Button
              size="1"
              color="green"
              variant={item.pass === true ? "solid" : "soft"}
              onClick={() => onToggleItem(i, true)}
            >
              Pass
            </Button>
            <Button
              size="1"
              color="red"
              variant={item.pass === false ? "solid" : "soft"}
              onClick={() => onToggleItem(i, false)}
            >
              Fail
            </Button>
          </Flex>
        </Flex>
      ))}
      <Text size="1" color="gray">
        <Kbd size="1">1</Kbd>-<Kbd size="1">9</Kbd> pass, <Kbd size="1">Shift</Kbd>+digit fail,
        again to clear. <Kbd size="1">n</Kbd> next unjudged.
      </Text>
    </>
  );
}
