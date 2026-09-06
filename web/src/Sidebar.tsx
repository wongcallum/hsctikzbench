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
import { useEffect, useState } from "react";
import { SampleBadges } from "./badges.tsx";
import { label, type ScoreLine } from "./sample.ts";
import type { Mode, SampleSummary } from "./types.ts";

interface Props {
  /** Samples to list; judging leaves out the ones with nothing left to judge. */
  samples: SampleSummary[];
  /** Score lines over every run, listed or not. */
  scores: ScoreLine[];
  /** Message shown in place of an empty listing. */
  empty: string;
  selected: string | null;
  mode: Mode;
  loading: boolean;
  onSelect: (stem: string) => void;
  onMode: (mode: Mode) => void;
  onRefresh: () => void;
}

export function Sidebar({
  samples,
  scores,
  empty,
  selected,
  mode,
  loading,
  onSelect,
  onMode,
  onRefresh
}: Props) {
  const exams = [...new Set(samples.map((s) => s.exam))];
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
            {exams.map((exam) => {
              const group = samples.filter((s) => s.exam === exam);
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
}
