import { Badge, Box, Button, Flex, Heading, RadioCards, ScrollArea, Text } from "@radix-ui/themes";
import { memo, useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { SampleInfo } from "../shared/types.ts";
import { sampleLabel, words } from "./format.ts";

interface Props<T extends SampleInfo> {
  heading: string;
  samples: T[];
  summary?: string;
  empty: string;
  selected: string | null;
  loading: boolean;
  badges: (sample: T) => ReactNode;
  onSelect: (stem: string) => void;
  onRefresh: () => void;
}

// Memoised because rebuilding a few hundred RadioCards rows costs upwards of 150ms; callers
// must keep badges, onSelect and onRefresh stable for that to hold.
export const SampleSidebar = memo(function SampleSidebar<T extends SampleInfo>({
  heading,
  samples,
  summary,
  empty,
  selected,
  loading,
  badges,
  onSelect,
  onRefresh
}: Props<T>) {
  const groups = new Map<string, T[]>();
  for (const sample of samples) {
    const group = groups.get(sample.exam);
    if (group) group.push(sample);
    else groups.set(sample.exam, [sample]);
  }
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (exam: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(exam)) next.add(exam);
      return next;
    });

  // Selecting a sample inside a collapsed exam opens it so the selection is never hidden. This
  // only fires when the selected exam changes, so collapsing the exam holding it still works.
  const selectedExam = samples.find((s) => s.stem === selected)?.exam ?? null;
  useEffect(() => {
    if (selectedExam === null) return;
    setCollapsed((current) => {
      if (!current.has(selectedExam)) return current;
      const next = new Set(current);
      next.delete(selectedExam);
      return next;
    });
  }, [selectedExam]);

  return (
    <Flex direction="column" minHeight="0">
      <Flex align="center" justify="between" p="3" gap="2">
        <Heading size="3">{heading}</Heading>
        <Button size="1" variant="soft" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </Flex>
      {summary && (
        <Box px="3" pb="2">
          <Text size="1" color="gray">
            {summary}
          </Text>
        </Box>
      )}
      <Box flexGrow="1" minHeight="0">
        <ScrollArea type="auto" scrollbars="vertical">
          <Box px="3" pb="3">
            {samples.length === 0 && !loading && (
              <Text as="p" size="2" color="gray">
                {empty}
              </Text>
            )}
            {[...groups].map(([exam, group]) => {
              const open = !collapsed.has(exam);
              return (
                <Flex key={exam} direction="column" gap="2" mt="2">
                  <Button
                    variant="ghost"
                    color="gray"
                    size="1"
                    onClick={() => toggle(exam)}
                    aria-expanded={open}
                    style={{ justifyContent: "flex-start" }}
                  >
                    <Flex as="span" align="center" gap="2" width="100%" minWidth="0">
                      <Text size="1">{open ? "▾" : "▸"}</Text>
                      <Text size="1" weight="bold" truncate>
                        {exam}
                      </Text>
                      <Text size="1" color="gray">
                        {group.length}
                      </Text>
                    </Flex>
                  </Button>
                  {open && (
                    <RadioCards.Root
                      orientation="vertical"
                      columns="1"
                      gap="2"
                      size="1"
                      value={selected ?? ""}
                      onValueChange={onSelect}
                    >
                      {group.map((sample) => (
                        <RadioCards.Item key={sample.stem} value={sample.stem}>
                          <Flex direction="column" gap="1" width="100%" minWidth="0">
                            <Text size="2" weight="medium" truncate>
                              {sampleLabel(sample)}
                            </Text>
                            <Flex align="center" gap="2" wrap="wrap">
                              <Badge color="gray" variant="outline" size="1">
                                {words(sample.category)}
                              </Badge>
                              {badges(sample)}
                            </Flex>
                          </Flex>
                        </RadioCards.Item>
                      ))}
                    </RadioCards.Root>
                  )}
                </Flex>
              );
            })}
          </Box>
        </ScrollArea>
      </Box>
    </Flex>
  );
}) as <T extends SampleInfo>(props: Props<T>) => ReactElement;
