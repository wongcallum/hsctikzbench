import { Flex, Text } from "@radix-ui/themes";
import type { CSSProperties } from "react";

interface Props {
  label: string;
  detail?: string;
  src: string | null;
  emptyText: string;
}

const frame: CSSProperties = {
  backgroundColor: "white",
  border: "1px solid var(--gray-a6)",
  borderRadius: "var(--radius-2)"
};

const fitted: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain"
};

export function ImagePane({ label, detail, src, emptyText }: Props) {
  return (
    <Flex direction="column" gap="2" minHeight="0" minWidth="0">
      <Flex align="baseline" gap="2">
        <Text size="2" weight="bold">
          {label}
        </Text>
        {detail && (
          <Text size="1" color="gray">
            {detail}
          </Text>
        )}
      </Flex>
      <Flex
        align="center"
        justify="center"
        flexGrow="1"
        minHeight="0"
        overflow="hidden"
        style={frame}
      >
        {src ? (
          <img src={src} alt={label} style={fitted} />
        ) : (
          <Text size="2" color="gray">
            {emptyText}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
