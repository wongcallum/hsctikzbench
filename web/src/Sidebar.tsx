import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  RadioCards,
  ScrollArea,
  SegmentedControl,
  Text
} from "@radix-ui/themes";
import { SampleBadges } from "./badges.tsx";
import { label, scoreLines } from "./sample.ts";
import type { Mode, SampleSummary } from "./types.ts";

interface Props {
  samples: SampleSummary[];
  selected: string | null;
  mode: Mode;
  loading: boolean;
  onSelect: (stem: string) => void;
  onMode: (mode: Mode) => void;
  onRefresh: () => void;
}

export function Sidebar({ samples, selected, mode, loading, onSelect, onMode, onRefresh }: Props) {
  const exams = [...new Set(samples.map((s) => s.exam))];
  return (
    <Flex direction="column" minHeight="0">
      <Flex align="center" justify="between" p="3" gap="2">
        <Heading size="3">Samples</Heading>
        <Flex align="center" gap="2">
          <SegmentedControl.Root
            size="1"
            value={mode}
            onValueChange={(value) => onMode(value === "view" ? "view" : "judge")}
          >
            <SegmentedControl.Item value="judge">Judge</SegmentedControl.Item>
            <SegmentedControl.Item value="view">View</SegmentedControl.Item>
          </SegmentedControl.Root>
          <Button size="1" variant="soft" onClick={onRefresh} disabled={loading}>
            Refresh
          </Button>
        </Flex>
      </Flex>
      <Flex direction="column" px="3" pb="2" gap="1">
        {scoreLines(samples, mode).map(({ batch, summary }) => (
          <Text key={batch ?? ""} size="1" color="gray">
            {batch !== null && (
              <>
                <Text weight="bold">{batch}</Text>
                {" · "}
              </>
            )}
            {summary}
          </Text>
        ))}
      </Flex>
      <Box flexGrow="1" minHeight="0">
        <ScrollArea type="auto" scrollbars="vertical">
          <Box px="3" pb="3">
            {samples.length === 0 && !loading && (
              <Text as="p" size="2" color="gray">
                No samples in the manifest.
              </Text>
            )}
            <RadioCards.Root
              columns="1"
              gap="2"
              size="1"
              value={selected ?? ""}
              onValueChange={onSelect}
            >
              {exams.map((exam) => (
                <Flex key={exam} direction="column" gap="2">
                  <Text size="1" weight="bold" color="gray" mt="2">
                    {exam}
                  </Text>
                  {samples
                    .filter((s) => s.exam === exam)
                    .map((sample) => (
                      <RadioCards.Item key={sample.stem} value={sample.stem}>
                        <Flex direction="column" gap="1" width="100%" minWidth="0">
                          <Text size="2" weight="medium" truncate>
                            {label(sample)}
                          </Text>
                          <Flex align="center" gap="2" wrap="wrap">
                            <Badge color="gray" variant="outline" size="1">
                              {sample.category.replaceAll("_", " ")}
                            </Badge>
                            <SampleBadges sample={sample} />
                          </Flex>
                        </Flex>
                      </RadioCards.Item>
                    ))}
                </Flex>
              ))}
            </RadioCards.Root>
          </Box>
        </ScrollArea>
      </Box>
    </Flex>
  );
}
