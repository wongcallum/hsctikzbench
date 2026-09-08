import { Box, Flex, Grid, Heading, Separator, TabNav } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import type { BatchSummary, Info } from "../shared/types.ts";
import { fetchBatches, fetchInfo } from "./api.ts";
import { BatchView } from "./BatchView.tsx";
import { JudgeApp } from "./judge/App.tsx";
import { Launch } from "./Launch.tsx";
import { confirmLeave, hrefFor, navigate, useRoute, type Route } from "./location.ts";
import { Sidebar } from "./Sidebar.tsx";

const BATCH_POLL_MS = 3000;

export function App() {
  const route = useRoute();
  return (
    <Flex direction="column" height="100vh">
      <TopNav route={route} />
      <Separator size="4" />
      <Box flexGrow="1" minHeight="0">
        {route.page === "judge" ? (
          <JudgeApp location={route} setLocation={(next) => navigate({ page: "judge", ...next })} />
        ) : (
          <Runs route={route} />
        )}
      </Box>
    </Flex>
  );
}

function TopNav({ route }: { route: Route }) {
  const tabs: [string, string, boolean][] = [
    ["Runs", hrefFor({ page: "launch", from: null }), route.page !== "judge"],
    ["Judge", "#/judge", route.page === "judge" && route.mode === "judge"],
    ["View", "#/view", route.page === "judge" && route.mode === "view"]
  ];
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
    </Flex>
  );
}

function Runs({ route }: { route: Exclude<Route, { page: "judge" }> }) {
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
      <Sidebar route={route} batches={batches} error={batchesError} />
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
