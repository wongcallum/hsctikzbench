import { Badge, Flex, Grid, Heading, RadioCards, Text } from "@radix-ui/themes";
import { runFileUrl } from "./api.ts";
import { ImagePane } from "./ImagePane.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import type { RunSummary } from "./types.ts";

interface Props {
  run: RunSummary;
  selectedRender: string | null;
  onSelectRender: (name: string | null) => void;
}

export function RunView({ run, selectedRender, onSelectRender }: Props) {
  const lastRender = run.renders.at(-1) ?? null;
  const submitted = run.result?.status === "submitted" && run.hasSubmission;
  const submittedRender = submitted ? lastRender : null;
  const shownRender = selectedRender ?? lastRender;

  let resultSrc: string | null;
  let resultDetail: string;
  if (selectedRender !== null) {
    resultSrc = runFileUrl(run.name, `renders/${selectedRender}`);
    resultDetail =
      selectedRender === submittedRender
        ? `renders/${selectedRender} (submitted)`
        : `renders/${selectedRender}`;
  } else if (submitted) {
    resultSrc = runFileUrl(run.name, "submission.png");
    resultDetail = "submission.png";
  } else if (lastRender !== null) {
    resultSrc = runFileUrl(run.name, `renders/${lastRender}`);
    resultDetail = `renders/${lastRender} (last render, not submitted)`;
  } else {
    resultSrc = null;
    resultDetail = "no renders";
  }

  return (
    <Flex direction="column" minHeight="0" minWidth="0">
      <Flex align="center" gap="3" p="4" wrap="wrap">
        <Heading size="4">{run.name}</Heading>
        <StatusBadge run={run} />
        {run.result && (
          <Flex align="center" gap="2" wrap="wrap">
            <Badge color="gray" variant="soft" size="1">
              {run.result.provider}/{run.result.model}@{run.result.reasoning}
            </Badge>
            <Badge color="gray" variant="soft" size="1">
              {run.result.turns} turns
            </Badge>
            <Badge color="gray" variant="soft" size="1">
              {run.result.renders} renders
            </Badge>
            <Badge color="gray" variant="soft" size="1">
              ${run.result.usage.cost.toFixed(4)}
            </Badge>
          </Flex>
        )}
        {run.result?.error && (
          <Text size="2" color="red">
            {run.result.error}
          </Text>
        )}
      </Flex>
      <Grid columns="2" gap="3" px="4" flexGrow="1" minHeight="0">
        <ImagePane
          label="Reference"
          detail="reference.png"
          src={run.hasReference ? runFileUrl(run.name, "reference.png") : null}
          emptyText="reference.png missing"
        />
        <ImagePane label="Result" detail={resultDetail} src={resultSrc} emptyText="no renders" />
      </Grid>
      {run.renders.length > 0 && (
        <Flex overflowX="auto" px="4" py="3" flexShrink="0">
          <RadioCards.Root
            columns={`repeat(${run.renders.length}, max-content)`}
            gap="2"
            size="1"
            value={shownRender ?? ""}
            onValueChange={(name) => onSelectRender(name === submittedRender ? null : name)}
          >
            {run.renders.map((name) => (
              <RadioCards.Item key={name} value={name}>
                <Flex direction="column" align="center" gap="1">
                  <img
                    src={runFileUrl(run.name, `renders/${name}`)}
                    alt={name}
                    style={{ height: 96, backgroundColor: "white" }}
                  />
                  <Text size="1" color="gray">
                    {name.replace(/\.png$/, "")}
                    {name === submittedRender ? " (submitted)" : ""}
                  </Text>
                </Flex>
              </RadioCards.Item>
            ))}
          </RadioCards.Root>
        </Flex>
      )}
    </Flex>
  );
}
