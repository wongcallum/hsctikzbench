import { Badge, DataList, Flex, Heading, Table, Text } from "@radix-ui/themes";
import type { Run } from "../shared/types.ts";
import { words } from "./format.ts";

const STANDING = {
  pass: "green",
  fail: "red",
  disputed: "purple",
  pending: "gray"
} as const;

const VERDICT = { pass: "green", fail: "red", needs_review: "orange" } as const;

const list = (logins: string[]) => logins.join(", ");

/** Why the run needs the owner, naming the judges involved. */
function disputeNote(run: Run): string {
  const standing = run.standing!;
  const votes = run.judgements ?? [];
  switch (standing.cause) {
    case "split":
      return "votes differ";
    case "needs_review":
      return `${list(votes.filter((j) => j.verdict === "needs_review").map((j) => j.judge))} asked for review`;
    case "held":
      return "you asked to look again";
    case "reopened": {
      const resolution = run.resolution!;
      const disagreeing = votes.filter(
        (j) => j.verdict !== resolution.verdict && j.judgedAt > resolution.judgedAt
      );
      return `${list(disagreeing.map((j) => j.judge))} voted against the resolution after it was given`;
    }
    default:
      return "";
  }
}

/** Where the run stands across the votes. Rendered only for the owner, who is told. */
export function StandingItem({ run }: { run: Run }) {
  const standing = run.standing;
  if (!standing) return null;
  const note =
    standing.verdict === "disputed"
      ? disputeNote(run)
      : standing.by === "owner"
        ? "settled by resolution"
        : standing.by === "judges"
          ? "votes agree"
          : standing.missing.length > 0
            ? `waiting on ${standing.missing.join(", ")}`
            : "no votes yet";
  return (
    <DataList.Item>
      <DataList.Label minWidth="80px">Standing</DataList.Label>
      <DataList.Value>
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color={STANDING[standing.verdict]} variant="soft" size="1">
            {standing.verdict}
          </Badge>
          <Text size="1" color="gray">
            {note}
          </Text>
          {standing.verdict === "disputed" && standing.missing.length > 0 && (
            <Text size="1" color="gray">
              · waiting on {standing.missing.join(", ")}
            </Text>
          )}
        </Flex>
      </DataList.Value>
    </DataList.Item>
  );
}

/** The owner's resolution of the run, when one has been given. Owner only. */
export function ResolutionItem({ run }: { run: Run }) {
  const resolution = run.resolution;
  if (!resolution) return null;
  return (
    <DataList.Item>
      <DataList.Label minWidth="80px">Resolution</DataList.Label>
      <DataList.Value>
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color={VERDICT[resolution.verdict]} variant="soft" size="1">
            {words(resolution.verdict)}
          </Badge>
          <Text size="1" color="gray" title={new Date(resolution.judgedAt).toLocaleString()}>
            by {resolution.by}
            {resolution.reason && ` · ${resolution.reason}`}
          </Text>
        </Flex>
      </DataList.Value>
    </DataList.Item>
  );
}

/** Every judge's vote and reason side by side. Owner only. */
export function JudgeVerdicts({ run, title = "Votes" }: { run: Run; title?: string }) {
  const judgements = run.judgements;
  if (!judgements) return null;
  return (
    <Flex direction="column" gap="2">
      <Heading size="2">{title}</Heading>
      {judgements.length === 0 ? (
        <Text size="2" color="gray">
          No votes yet.
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
