import { Flex, RadioCards, Text } from "@radix-ui/themes";
import type { Run } from "../shared/types.ts";
import { runFileUrl } from "./api.ts";

interface Props {
  run: Run;
  selected: string;
  submitted: string | null;
  onSelect: (name: string) => void;
}

export function RenderStrip({ run, selected, submitted, onSelect }: Props) {
  if (run.renders.length === 0) return null;
  return (
    <Flex overflowX="auto" px="4" py="3" flexShrink="0">
      <RadioCards.Root
        orientation="horizontal"
        columns={`repeat(${run.renders.length}, max-content)`}
        gap="2"
        size="1"
        value={selected}
        onValueChange={onSelect}
      >
        {run.renders.map((name) => (
          <RadioCards.Item key={name} value={name}>
            <Flex direction="column" align="center" gap="1">
              <img
                src={runFileUrl(run.id, `renders/${name}`)}
                alt={name}
                loading="lazy"
                style={{ height: 96, backgroundColor: "white" }}
              />
              <Text size="1" color="gray">
                {name.replace(/\.png$/, "")}
                {name === submitted ? " (submitted)" : ""}
              </Text>
            </Flex>
          </RadioCards.Item>
        ))}
      </RadioCards.Root>
    </Flex>
  );
}
