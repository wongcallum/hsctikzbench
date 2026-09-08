import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Heading,
  RadioCards,
  ScrollArea,
  Text
} from "@radix-ui/themes";
import type { BatchSummary, StatusCounts } from "../shared/types.ts";
import { jobTone, money, relative } from "./format.ts";
import { hrefFor, navigate, type Route } from "./location.ts";

interface Props {
  route: Route;
  batches: BatchSummary[];
  error: string | null;
}

export function Sidebar({ route, batches, error }: Props) {
  const current = route.page === "batch" ? route.name : null;
  return (
    <Flex direction="column" minHeight="0">
      <Flex align="center" justify="between" p="3" gap="2">
        <Heading size="3">Batches</Heading>
        <Button asChild size="1" variant={route.page === "launch" ? "solid" : "soft"}>
          <a href={hrefFor({ page: "launch", from: null })}>New run</a>
        </Button>
      </Flex>
      {error && (
        <Box px="3" pb="2">
          <Callout.Root color="red" size="1">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        </Box>
      )}
      <Box flexGrow="1" minHeight="0">
        <ScrollArea type="auto" scrollbars="vertical">
          <Box px="3" pb="3">
            {batches.length === 0 && !error && (
              <Text as="p" size="2" color="gray">
                No runs yet.
              </Text>
            )}
            <RadioCards.Root
              orientation="vertical"
              columns="1"
              gap="2"
              size="1"
              value={current ?? ""}
              onValueChange={(name) => navigate({ page: "batch", name, stem: null })}
            >
              {batches.map((batch) => (
                <RadioCards.Item key={batch.name} value={batch.name}>
                  <Flex direction="column" gap="1" width="100%" minWidth="0">
                    <Flex align="center" justify="between" gap="2" minWidth="0">
                      <Text size="2" weight="medium" truncate title={batch.name}>
                        {batch.name}
                      </Text>
                      {batch.jobStatus && (
                        <Badge color={jobTone[batch.jobStatus]} variant="soft" size="1">
                          {batch.jobStatus}
                        </Badge>
                      )}
                    </Flex>
                    <CountBar counts={batch.counts} />
                    <Flex justify="between" gap="2" minWidth="0">
                      <Text size="1" color="gray" truncate title={batch.model ?? ""}>
                        {batch.model ?? "no results"}
                      </Text>
                      <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>
                        {batch.cost > 0 ? `${money(batch.cost)} · ` : ""}
                        {relative(batch.updatedAt)}
                      </Text>
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

const SEGMENTS: [keyof StatusCounts, string][] = [
  ["submitted", "var(--green-9)"],
  ["max_turns", "var(--orange-9)"],
  ["error", "var(--red-9)"],
  ["interrupted", "var(--orange-6)"],
  ["running", "var(--blue-9)"],
  ["pending", "var(--gray-6)"]
];

export function CountBar({ counts }: { counts: StatusCounts }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const title = SEGMENTS.filter(([k]) => counts[k] > 0)
    .map(([k]) => `${counts[k]} ${k.replaceAll("_", " ")}`)
    .join(", ");
  return (
    <Flex
      height="6px"
      width="100%"
      overflow="hidden"
      title={title}
      style={{ borderRadius: "var(--radius-1)", backgroundColor: "var(--gray-a4)" }}
    >
      {total > 0 &&
        SEGMENTS.map(
          ([key, color]) =>
            counts[key] > 0 && (
              <Box key={key} style={{ flex: counts[key], backgroundColor: color }} />
            )
        )}
    </Flex>
  );
}
