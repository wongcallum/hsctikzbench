import { Box, Button, Flex, Text, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LogLine, LogStream } from "../shared/types.ts";

interface Props {
  lines: LogLine[];
  filter: string;
  onFilter: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  running: boolean;
}

const SHOW_MAX = 3000;

/** Progress events are for the progress table, not for reading. */
export const isShown = (line: LogLine) => line.stream !== "progress";

export function LogPane({ lines, filter, onFilter, open, onToggle, running }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const q = filter.trim();
  const readable = lines.filter(isShown);
  const shown = (q ? readable.filter((l) => l.text.includes(q)) : readable).slice(-SHOW_MAX);

  useEffect(() => {
    if (follow && open && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [shown.length, follow, open]);

  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  return (
    <Flex
      direction="column"
      flexShrink="0"
      height={open ? "280px" : undefined}
      style={{ borderTop: "1px solid var(--gray-a6)" }}
    >
      <Flex align="center" gap="3" px="3" py="2">
        <Button variant="ghost" size="1" color="gray" onClick={onToggle}>
          {open ? "▾" : "▸"} log
        </Button>
        <Text size="1" color="gray">
          {readable.length} lines{running ? " · live" : ""}
          {q ? ` · ${shown.length} match` : ""}
        </Text>
        <TextField.Root
          size="1"
          placeholder="filter lines"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
        {!follow && open && (
          <Button
            size="1"
            variant="soft"
            onClick={() => {
              setFollow(true);
              if (body.current) body.current.scrollTop = body.current.scrollHeight;
            }}
          >
            Jump to end
          </Button>
        )}
      </Flex>
      {open && (
        <Box
          ref={body}
          flexGrow="1"
          minHeight="0"
          overflow="auto"
          px="3"
          pb="2"
          onScroll={onScroll}
        >
          <LogLines lines={shown} empty="No output yet." />
        </Box>
      )}
    </Flex>
  );
}

const mono: CSSProperties = {
  fontFamily: "var(--code-font-family)",
  fontSize: "var(--font-size-1)",
  lineHeight: "var(--line-height-1)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere"
};

const STREAM_COLOR: Record<LogStream, string> = {
  out: "var(--gray-12)",
  err: "var(--gray-11)",
  sys: "var(--blue-11)",
  progress: "var(--gray-9)"
};

export function LogLines({ lines, empty }: { lines: LogLine[]; empty: string }) {
  if (lines.length === 0) {
    return (
      <Text as="p" size="1" color="gray">
        {empty}
      </Text>
    );
  }
  return (
    <div style={mono}>
      {lines.map((line) => (
        <div key={line.n} style={{ display: "flex", gap: 12 }}>
          <span style={{ color: "var(--gray-9)", flexShrink: 0 }}>
            {new Date(line.t).toLocaleTimeString()}
          </span>
          <span style={{ color: STREAM_COLOR[line.stream] }}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
