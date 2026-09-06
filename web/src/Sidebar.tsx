import { Badge, Box, Button, Flex, Heading, RadioCards, ScrollArea, Text } from "@radix-ui/themes";
import { RunBadges } from "./badges.tsx";
import { label, scoreSummary } from "./sample.ts";
import type { SampleSummary } from "./types.ts";

interface Props {
  samples: SampleSummary[];
  selected: string | null;
  loading: boolean;
  onSelect: (stem: string) => void;
  onRefresh: () => void;
}

export function Sidebar({ samples, selected, loading, onSelect, onRefresh }: Props) {
  const exams = [...new Set(samples.map((s) => s.exam))];
  return (
    <Flex direction="column" minHeight="0">
      <Flex align="center" justify="between" p="3" gap="2">
        <Heading size="3">Samples</Heading>
        <Button size="1" variant="soft" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </Flex>
      <Box px="3" pb="2">
        <Text size="1" color="gray">
          {scoreSummary(samples)}
        </Text>
      </Box>
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
                            <RunBadges sample={sample} />
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
