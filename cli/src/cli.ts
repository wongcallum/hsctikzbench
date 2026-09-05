import { buildApplication, buildRouteMap, run, text_en } from "@stricli/core";
import { datasetRoutes } from "./commands/dataset.ts";
import { loginCommand } from "./commands/login.ts";
import { runCommand } from "./commands/run.ts";

const routes = buildRouteMap({
  routes: { run: runCommand, login: loginCommand, dataset: datasetRoutes },
  docs: { brief: "HSCTikZBench benchmark CLI" }
});

export const app = buildApplication(routes, {
  name: "hsctikzbench",
  scanner: { caseStyle: "allow-kebab-for-camel" },
  localization: {
    loadText: () => ({
      ...text_en,
      exceptionWhileRunningCommand: (exc) =>
        `error: ${exc instanceof Error ? exc.message : String(exc)}`
    })
  }
});

await run(app, process.argv.slice(2), { process });
