import { Badge, Box, Button, Flex, Grid, Heading, Separator, TabNav, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import type { BatchSummary, Info, Me } from "../shared/types.ts";
import { fetchBatches, fetchInfo, fetchMe, signOut } from "./api.ts";
import { Assignments } from "./Assignments.tsx";
import { BatchView } from "./BatchView.tsx";
import { SIGNED_OUT_EVENT } from "./http.ts";
import { BatchSidebar } from "./BatchSidebar.tsx";
import { JudgeApp } from "./JudgeApp.tsx";
import { Launch } from "./Launch.tsx";
import { confirmLeave, hrefFor, navigate, useRoute, type Route } from "./location.ts";
import { SignIn } from "./SignIn.tsx";

const BATCH_POLL_MS = 3000;

export function App() {
  const route = useRoute();
  // undefined while the first /api/me is in flight; null when signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    fetchMe().then(setMe, () => setMe(null));
    const signedOut = () => setMe(null);
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  const owner = me?.role === "owner";
  const allowed = owner || (route.page === "judge" && route.mode === "judge");
  useEffect(() => {
    if (me && !allowed) navigate({ page: "judge", mode: "judge", stem: null, run: null });
  }, [me, allowed]);

  if (me === undefined) return null;
  if (me === null) return <SignIn />;
  if (!allowed) return null;

  return (
    <Flex direction="column" height="100vh">
      <TopNav route={route} me={me} onSignOut={() => setMe(null)} />
      <Separator size="4" />
      <Box flexGrow="1" minHeight="0">
        {route.page === "judge" ? (
          <JudgeApp
            location={route}
            setLocation={(next) => navigate({ page: "judge", ...next })}
            role={me.role}
          />
        ) : route.page === "assign" ? (
          <Assignments />
        ) : (
          <Runs route={route} />
        )}
      </Box>
    </Flex>
  );
}

function TopNav({ route, me, onSignOut }: { route: Route; me: Me; onSignOut: () => void }) {
  const owner = me.role === "owner";
  const judging = (mode: string) => route.page === "judge" && route.mode === mode;
  const tabs: [string, string, boolean][] = owner
    ? [
        [
          "Runs",
          hrefFor({ page: "launch", from: null }),
          route.page === "launch" || route.page === "batch"
        ],
        ["Judge", "#/judge", judging("judge")],
        ["Resolve", "#/resolve", judging("resolve")],
        ["View", "#/view", judging("view")],
        ["Judges", "#/assign", route.page === "assign"]
      ]
    : [["Judge", "#/judge", true]];
  const [signingOut, setSigningOut] = useState(false);
  const leave = async () => {
    if (!confirmLeave()) return;
    setSigningOut(true);
    try {
      await signOut();
      // Drop any ?auth= leftovers along with the page state.
      window.history.replaceState(null, "", "/");
      onSignOut();
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <Flex align="center" gap="4" px="4" flexShrink="0">
      <Heading size="3">HSCTikZBench</Heading>
      <TabNav.Root>
        {tabs.map(([label, href, active]) => (
          <TabNav.Link
            key={label}
            href={href}
            active={active}
            onClick={(event) => {
              if (!confirmLeave()) event.preventDefault();
            }}
          >
            {label}
          </TabNav.Link>
        ))}
      </TabNav.Root>
      <Flex align="center" gap="2" ml="auto">
        <Text size="2">{me.login}</Text>
        <Badge color={owner ? "blue" : "gray"} variant="soft" size="1">
          {me.role}
        </Badge>
        <Button size="1" variant="soft" color="gray" onClick={leave} disabled={signingOut}>
          Sign out
        </Button>
      </Flex>
    </Flex>
  );
}

function Runs({ route }: { route: Exclude<Route, { page: "judge" | "assign" }> }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const loadInfo = useCallback(() => {
    setInfoError(null);
    fetchInfo().then(setInfo, (e: Error) => setInfoError(e.message));
  }, []);
  useEffect(loadInfo, [loadInfo]);

  const refreshBatches = useCallback(async () => {
    try {
      setBatches(await fetchBatches());
      setBatchesError(null);
    } catch (e) {
      setBatchesError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshBatches();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshBatches();
    }, BATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshBatches]);

  return (
    <Grid columns="280px auto 1fr" height="100%">
      <BatchSidebar route={route} batches={batches} error={batchesError} />
      <Separator orientation="vertical" size="4" />
      <Box minHeight="0" minWidth="0">
        {route.page === "launch" ? (
          <Launch
            key={route.from ?? ""}
            from={route.from}
            info={info}
            infoError={infoError}
            onRetry={loadInfo}
            batches={batches}
            onLaunched={refreshBatches}
          />
        ) : (
          <BatchView
            key={route.name}
            name={route.name}
            stem={route.stem}
            onChanged={refreshBatches}
          />
        )}
      </Box>
    </Grid>
  );
}
