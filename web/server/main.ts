import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApi } from "./api.ts";
import { config, repoProblems } from "./env.ts";
import { JobManager } from "./jobs.ts";

const jobs = new JobManager();
await jobs.load();

const app = createApi(jobs);

const dist = path.join(config.root, "dist");
if (config.production) {
  if (!existsSync(path.join(dist, "index.html"))) {
    console.error(`no built UI in ${dist}; run pnpm build first`);
    process.exit(1);
  }
  const root = path.relative(process.cwd(), dist) || ".";
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (address) => {
  console.log(`listening on http://${address.address}:${address.port}`);
  console.log(`runs: ${config.runsDir}`);
  console.log(`state: ${config.stateDir}`);
  for (const problem of repoProblems()) console.warn(`warning: ${problem}`);
  if (!config.production) console.log("UI: run `pnpm dev` and open the vite URL");
});

let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: stopping jobs`);
  void jobs.shutdown().finally(() => {
    server.close();
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
