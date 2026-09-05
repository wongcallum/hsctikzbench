import { Button, Flex, Kbd, Text } from "@radix-ui/themes";
import { hasSubmission, mergeItems } from "./sample.ts";
import type { SampleSummary } from "./types.ts";

interface Props {
  sample: SampleSummary;
  onToggleItem: (index: number, wanted: boolean) => void;
  onNoSubmission: () => void;
}

export function JudgingPanel({ sample, onToggleItem, onNoSubmission }: Props) {
  return (
    <Flex direction="column" gap="3">
      <Text size="2" weight="bold">
        Judgement
      </Text>
      <Body sample={sample} onToggleItem={onToggleItem} onNoSubmission={onNoSubmission} />
    </Flex>
  );
}

function Body({ sample, onToggleItem, onNoSubmission }: Props) {
  const run = sample.run;
  if (!run) {
    return (
      <Text size="2" color="gray">
        No run for this sample.
      </Text>
    );
  }
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
  if (sample.checklist === null) {
    return (
      <Text size="2" color="gray">
        No checklist to judge against. Turn on Edit checklist to create one.
      </Text>
    );
  }
  const items = mergeItems(sample.checklist, run.judgement);
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
        again to clear.
      </Text>
    </>
  );
}
