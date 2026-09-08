import { Button, Callout, Card, Flex, Heading, Text } from "@radix-ui/themes";

function outcome(): string | null {
  const params = new URLSearchParams(window.location.search);
  const login = params.get("login");
  switch (params.get("auth")) {
    case "denied":
      return `The GitHub account ${login ?? ""} is not on the list of judges.`;
    case "unknown":
      return `AUTH_DEV_USER is set to ${login ?? "a login"} that is not in the users file.`;
    case "error":
      return "Signing in with GitHub did not complete. Try again.";
    default:
      return null;
  }
}

export function SignIn() {
  const message = outcome();
  return (
    <Flex align="center" justify="center" height="100vh" p="4">
      <Card size="3" style={{ width: 380 }}>
        <Flex direction="column" gap="4">
          <Heading size="5">HSCTikZBench</Heading>
          <Text size="2" color="gray">
            Judging is by invitation. Sign in with the GitHub account that was invited.
          </Text>
          {message && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{message}</Callout.Text>
            </Callout.Root>
          )}
          <Button asChild size="3">
            <a href="/auth/login">Sign in with GitHub</a>
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
