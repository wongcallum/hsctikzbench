import { Badge, Box, Button, Flex, Heading, RadioCards, ScrollArea, Text } from "@radix-ui/themes";
import { memo, useEffect, useState } from "react";
import { SampleBadges } from "./badges.tsx";
import { label, type ScoreLine } from "./sample.ts";
import type { SampleSummary } from "../../shared/judge.ts";
import type { Mode } from "../location.ts";

interface Props {
  samples: SampleSummary[];
  scores: ScoreLine[];
  empty: string;
  selected: string | null;
  mode: Mode;
  loading: boolean;
  onSelect: (stem: string) => void;
  onRefresh: () => void;
}

// Memoised because rebuilding a few hundred RadioCards rows costs upwards of 150ms; callers
// must keep onSelect and onRefresh stable for that to hold.
export const Sidebar = memo(function Sidebar({
  samples,
  scores,
  empty,
  selected,
  mode,
  loading,
  onSelect,
  onRefresh
}: Props) {
  const groups = new Map<string, SampleSummary[]>();
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
        <Heading size="3">{mode === "judge" ? "To judge" : "Samples"}</Heading>
        <Button size="1" variant="soft" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </Flex>
      <Flex direction="column" px="3" pb="2" gap="1">
        {scores.map(({ batch, summary }) => (
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
});
