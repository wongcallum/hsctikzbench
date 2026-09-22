import { Flex, Kbd, Text } from "@radix-ui/themes";

export interface Hint {
  keys: string[];
  label: string;
}

export function KeyHints({ hints }: { hints: Hint[] }) {
  return (
    <Flex align="center" gapX="5" gapY="2" wrap="wrap">
      {hints.map((hint) => (
        <Flex key={hint.label} align="center" gap="2">
          <Flex align="center" gap="1">
            {hint.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </Flex>
          <Text size="1" color="gray">
            {hint.label}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}
