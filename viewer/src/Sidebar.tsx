import { Box, Button, Flex, Heading, RadioCards, ScrollArea, Text } from "@radix-ui/themes";
import { isJudgeable, judgingState } from "./judging.ts";
import { JudgingBadge } from "./JudgingBadge.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import type { RunSummary } from "./types.ts";

interface Props {
  runs: RunSummary[];
  selected: string | null;
  loading: boolean;
  onSelect: (name: string) => void;
  onRefresh: () => void;
}

export function Sidebar({ runs, selected, loading, onSelect, onRefresh }: Props) {
  return (
    <Flex direction="column" minHeight="0">
      <Flex align="center" justify="between" p="3" gap="2">
        <Heading size="3">Runs</Heading>
        <Button size="1" variant="soft" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </Flex>
      <Box px="3" pb="2">
        <Text size="1" color="gray">
          {summary(runs)}
        </Text>
      </Box>
      <Box flexGrow="1" minHeight="0">
        <ScrollArea type="auto" scrollbars="vertical">
          <Box px="3" pb="3">
            {runs.length === 0 && !loading && (
              <Text as="p" size="2" color="gray">
                No runs found.
              </Text>
            )}
            <RadioCards.Root
              columns="1"
              gap="2"
              size="1"
              value={selected ?? ""}
              onValueChange={onSelect}
            >
              {runs.map((run) => (
                <RadioCards.Item key={run.name} value={run.name}>
                  <Flex direction="column" gap="1" width="100%" minWidth="0">
                    <Text size="2" weight="medium" truncate>
                      {run.name}
                    </Text>
                    <Flex align="center" gap="2">
                      <StatusBadge run={run} />
                      <JudgingBadge state={judgingState(run)} />
                    </Flex>
                  </Flex>
                </RadioCards.Item>
              ))}
            </RadioCards.Root>
          </Box>
        </ScrollArea>
      </Box>
    </Flex>
  );
}

function summary(runs: RunSummary[]): string {
  const states = runs.filter(isJudgeable).map(judgingState);
  const judged = states.filter((s) => s === "pass" || s === "fail").length;
  const passed = states.filter((s) => s === "pass").length;
  return `judged ${judged}/${states.length} · ${passed} pass`;
}
