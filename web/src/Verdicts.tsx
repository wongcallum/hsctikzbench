import { Badge, DataList, Flex, Heading, Table, Text } from "@radix-ui/themes";
import type { Run } from "../shared/types.ts";
import { words } from "./format.ts";

const RESOLUTION = {
  pass: "green",
  fail: "red",
  disputed: "purple",
  pending: "gray"
} as const;

const VERDICT = { pass: "green", fail: "red", needs_review: "orange" } as const;

/** How the run stands across judges. Rendered only for the owner, who is told. */
export function ResolutionItem({ run }: { run: Run }) {
  const resolution = run.resolution;
  if (!resolution) return null;
  const note =
    resolution.by === "owner"
      ? "settled by you"
      : resolution.by === "judges"
        ? resolution.verdict === "disputed"
          ? "judges differ"
          : "judges agree"
        : resolution.missing.length > 0
          ? `waiting on ${resolution.missing.join(", ")}`
          : "no verdicts yet";
  return (
    <DataList.Item>
      <DataList.Label minWidth="80px">Verdict</DataList.Label>
      <DataList.Value>
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color={RESOLUTION[resolution.verdict]} variant="soft" size="1">
            {resolution.verdict}
          </Badge>
          <Text size="1" color="gray">
            {note}
          </Text>
          {resolution.by === "judges" && resolution.missing.length > 0 && (
            <Text size="1" color="gray">
              · waiting on {resolution.missing.join(", ")}
            </Text>
          )}
        </Flex>
      </DataList.Value>
    </DataList.Item>
  );
}

/** Every judge's verdict and reason side by side. Owner only. */
export function JudgeVerdicts({ run, title = "Judges" }: { run: Run; title?: string }) {
  const judgements = run.judgements;
  if (!judgements) return null;
  return (
    <Flex direction="column" gap="2">
      <Heading size="2">{title}</Heading>
      {judgements.length === 0 ? (
        <Text size="2" color="gray">
          No judgements yet.
        </Text>
      ) : (
        <Table.Root size="1" variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Judge</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Verdict</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Reason</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {judgements.map((judgement) => (
              <Table.Row key={judgement.judge}>
                <Table.RowHeaderCell>
                  <Text size="1" title={new Date(judgement.judgedAt).toLocaleString()}>
                    {judgement.judge}
                  </Text>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <Badge color={VERDICT[judgement.verdict]} variant="soft" size="1">
                    {words(judgement.verdict)}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text size="1" style={{ whiteSpace: "pre-wrap" }}>
                    {judgement.reason || <Text color="gray">—</Text>}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Flex>
  );
}
