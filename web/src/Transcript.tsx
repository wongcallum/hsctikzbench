import { Badge, Box, Callout, Card, Flex, Text } from "@radix-ui/themes";
import type { CSSProperties, ReactNode } from "react";

export interface TranscriptFile {
  systemPrompt?: string;
  messages: Message[];
}

type Part =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "image"; data: string; mimeType?: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

interface Message {
  role: string;
  content: string | Part[];
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; cost?: { total?: number } };
}

export const pre: CSSProperties = {
  margin: 0,
  fontFamily: "var(--code-font-family)",
  fontSize: "var(--font-size-1)",
  lineHeight: "var(--line-height-2)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere"
};

const ROLE_COLOR: Record<string, "gray" | "blue" | "green" | "orange"> = {
  system: "gray",
  user: "blue",
  assistant: "green",
  toolResult: "orange"
};

export function Transcript({
  file,
  imageUrl
}: {
  file: TranscriptFile;
  imageUrl: (name: string) => string;
}) {
  return (
    <Flex direction="column" gap="3">
      {file.systemPrompt && (
        <Card size="1">
          <details>
            <summary>
              <Badge color="gray" variant="soft" size="1">
                system prompt
              </Badge>
            </summary>
            <Box pt="2">
              <pre style={pre}>{file.systemPrompt}</pre>
            </Box>
          </details>
        </Card>
      )}
      {file.messages.map((message, i) => (
        <MessageView key={i} index={i} message={message} imageUrl={imageUrl} />
      ))}
    </Flex>
  );
}

function MessageView({
  index,
  message,
  imageUrl
}: {
  index: number;
  message: Message;
  imageUrl: (name: string) => string;
}) {
  const parts: Part[] =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content;
  const title =
    message.role === "toolResult"
      ? `${message.toolName ?? "tool"} result${message.isError ? " (error)" : ""}`
      : message.role;
  const meta: string[] = [];
  if (message.stopReason) meta.push(`stop=${message.stopReason}`);
  if (message.usage?.input !== undefined) meta.push(`in=${message.usage.input}`);
  if (message.usage?.output !== undefined) meta.push(`out=${message.usage.output}`);
  if (message.usage?.cost?.total !== undefined)
    meta.push(`$${message.usage.cost.total.toFixed(4)}`);
  return (
    <Card size="1">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="1" color="gray">
            #{index}
          </Text>
          <Badge color={message.isError ? "red" : (ROLE_COLOR[message.role] ?? "gray")} size="1">
            {title}
          </Badge>
          {meta.length > 0 && (
            <Text size="1" color="gray">
              {meta.join(" · ")}
            </Text>
          )}
        </Flex>
        {message.errorMessage && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{message.errorMessage}</Callout.Text>
          </Callout.Root>
        )}
        {parts.map((part, i) => (
          <PartView key={i} part={part} imageUrl={imageUrl} />
        ))}
      </Flex>
    </Card>
  );
}

function PartView({
  part,
  imageUrl
}: {
  part: Part;
  imageUrl: (name: string) => string;
}): ReactNode {
  switch (part.type) {
    case "text":
      return <pre style={pre}>{String(part["text"])}</pre>;
    case "thinking":
      return (
        <details>
          <summary>
            <Text size="1" color="gray">
              thinking
            </Text>
          </summary>
          <pre style={{ ...pre, color: "var(--gray-11)" }}>{String(part["thinking"])}</pre>
        </details>
      );
    case "image": {
      const name = String(part["data"]);
      return (
        <Flex direction="column" gap="1" align="start">
          <img
            src={imageUrl(name)}
            alt={name}
            loading="lazy"
            style={{
              maxWidth: "100%",
              maxHeight: 320,
              backgroundColor: "white",
              border: "1px solid var(--gray-a6)",
              borderRadius: "var(--radius-2)"
            }}
          />
          <Text size="1" color="gray">
            {name}
          </Text>
        </Flex>
      );
    }
    case "toolCall": {
      const args = (part["arguments"] ?? {}) as Record<string, unknown>;
      const source = typeof args["source"] === "string" ? args["source"] : null;
      return (
        <Flex direction="column" gap="2" align="start">
          <Badge color="gray" variant="outline" size="1">
            {String(part["name"])}
          </Badge>
          {source ? (
            <details>
              <summary>
                <Text size="1" color="gray">
                  source ({source.split("\n").length} lines)
                </Text>
              </summary>
              <pre style={pre}>{source}</pre>
            </details>
          ) : Object.keys(args).length > 0 ? (
            <pre style={pre}>{JSON.stringify(args, null, 2)}</pre>
          ) : null}
        </Flex>
      );
    }
    default:
      return <pre style={{ ...pre, color: "var(--gray-11)" }}>{JSON.stringify(part)}</pre>;
  }
}
