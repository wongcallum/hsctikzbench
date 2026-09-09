import { Flex, Text } from "@radix-ui/themes";
import type { Run } from "../shared/types.ts";
import { cropUrl, runFileUrl } from "./api.ts";

type Props =
  | { kind: "crop"; stem: string; missing: boolean; label: string }
  | { kind: "run"; run: Run; file: string | null; label: string };

export function Thumb(props: Props) {
  const src =
    props.kind === "crop"
      ? props.missing
        ? null
        : cropUrl(props.stem)
      : props.file
        ? runFileUrl(props.run.id, props.file)
        : null;
  return (
    <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
      <Flex
        align="center"
        justify="center"
        height="120px"
        overflow="hidden"
        style={{
          backgroundColor: "white",
          border: "1px solid var(--gray-a6)",
          borderRadius: "var(--radius-2)"
        }}
      >
        {src && (
          <img
            src={src}
            alt={props.label}
            loading="lazy"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        )}
      </Flex>
      <Text size="1" color="gray" truncate>
        {props.label}
      </Text>
    </Flex>
  );
}
