import {
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  Flex,
  Heading,
  ScrollArea,
  Table,
  Text
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Assignments as Table_, AssignmentsView } from "../shared/types.ts";
import { fetchAssignments, saveAssignments } from "./api.ts";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const same = (a: Table_, b: Table_) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (table: Table_): Table_ =>
  Object.fromEntries(
    Object.entries(table)
      .filter(([, batches]) => batches.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([login, batches]) => [login, [...batches].sort()])
  );

export function Assignments() {
  const [view, setView] = useState<AssignmentsView | null>(null);
  const [draft, setDraft] = useState<Table_>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchAssignments();
      setView(next);
      setDraft(next.assignments);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Everyone in the users file, plus any login the assignments file names that has left it.
  const logins = useMemo(() => {
    if (!view) return [];
    return [...new Set([...Object.keys(view.users), ...Object.keys(view.assignments)])].sort();
  }, [view]);
  const dirty = view !== null && !same(draft, view.assignments);

  const toggle = (login: string, batch: string, on: boolean) =>
    setDraft((current) => {
      const batches = new Set(current[login] ?? []);
      if (on) batches.add(batch);
      else batches.delete(batch);
      return { ...current, [login]: [...batches].sort() };
    });

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveAssignments(draft);
      setView(next);
      setDraft(next.assignments);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollArea type="auto" scrollbars="both">
      <Box p="4">
        <Flex direction="column" gap="4" style={{ maxWidth: 1100 }}>
          <Flex align="center" gap="3" wrap="wrap">
            <Heading size="5">Judges</Heading>
            <Flex gap="2" ml="auto">
              <Button variant="soft" onClick={() => void load()} disabled={saving}>
                Reload
              </Button>
              <Button
                variant="soft"
                onClick={() => view && setDraft(view.assignments)}
                disabled={!dirty || saving}
              >
                Discard
              </Button>
              <Button onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </Flex>
          </Flex>
          <Text size="2" color="gray">
            Tick the batches each login should judge. Everyone votes blind on what is assigned to
            them, you included; resolving is separate and covers every batch. Counts are judgeable
            runs the login has voted on over the batch's total.
          </Text>
          {error && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {view && logins.length === 0 && (
            <Text size="2" color="gray">
              No users yet. Add GitHub logins to the users file.
            </Text>
          )}
          {view && logins.length > 0 && (
            <Table.Root size="1" variant="surface">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Judge</Table.ColumnHeaderCell>
                  {view.batches.map((batch) => (
                    <Table.ColumnHeaderCell key={batch}>
                      <Text size="1" style={{ whiteSpace: "nowrap" }}>
                        {batch}
                      </Text>
                    </Table.ColumnHeaderCell>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {logins.map((login) => (
                  <Table.Row key={login}>
                    <Table.RowHeaderCell>
                      <Flex direction="column" align="start" gap="1">
                        <Text size="2">{login}</Text>
                        {view.users[login] ? (
                          <Badge
                            color={view.users[login] === "owner" ? "blue" : "gray"}
                            variant="soft"
                            size="1"
                          >
                            {view.users[login]}
                          </Badge>
                        ) : (
                          <Text size="1" color="orange">
                            not in the users file
                          </Text>
                        )}
                      </Flex>
                    </Table.RowHeaderCell>
                    {view.batches.map((batch) => {
                      const on = draft[login]?.includes(batch) ?? false;
                      const progress = view.progress[login]?.[batch];
                      return (
                        <Table.Cell key={batch}>
                          <Flex direction="column" align="start" gap="1">
                            <Checkbox
                              checked={on}
                              onCheckedChange={(value) => toggle(login, batch, value === true)}
                              aria-label={`${login} judges ${batch}`}
                            />
                            {on && progress && (
                              <Text
                                size="1"
                                color={progress.judged === progress.total ? "green" : "gray"}
                              >
                                {progress.judged}/{progress.total}
                              </Text>
                            )}
                          </Flex>
                        </Table.Cell>
                      );
                    })}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Flex>
      </Box>
    </ScrollArea>
  );
}
