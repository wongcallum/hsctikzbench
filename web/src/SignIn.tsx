import { Button, Callout, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import type { AuthMode } from "../shared/types.ts";
import { fetchAuthMode } from "./api.ts";

function outcome(): string | null {
  const params = new URLSearchParams(window.location.search);
  const login = params.get("login");
  switch (params.get("auth")) {
    case "denied":
      return `The GitHub account ${login ?? ""} is not on the list of judges.`;
    case "error":
      return "Signing in with GitHub did not complete. Try again.";
    default:
      return null;
  }
}

const COPY: Record<AuthMode, { blurb: string; button: string }> = {
  github: {
    blurb: "Welcome to the HSCTikZBench judging interface.",
    button: "Sign in with GitHub"
  },
  single: {
    blurb: "HSCTikZBench is running in single-user mode.",
    button: "Continue"
  }
};

export function SignIn() {
  const message = outcome();
  const [mode, setMode] = useState<AuthMode>("github");
  useEffect(() => {
    fetchAuthMode().then(setMode, () => setMode("github"));
  }, []);
  const copy = COPY[mode];
  return (
    <Flex align="center" justify="center" height="100vh" p="4">
      <Card size="3" style={{ width: 380 }}>
        <Flex direction="column" gap="4">
          <Heading size="5">HSCTikZBench</Heading>
          <Text size="2" color="gray">
            {copy.blurb}
          </Text>
          {message && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{message}</Callout.Text>
            </Callout.Root>
          )}
          <Button asChild size="3">
            <a href="/auth/login">{copy.button}</a>
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
