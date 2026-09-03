import { buildApplication, buildRouteMap, run, text_en } from "@stricli/core";
import { loginCommand } from "./commands/login.ts";
import { runCommand } from "./commands/run.ts";

const routes = buildRouteMap({
  routes: { run: runCommand, login: loginCommand },
  docs: { brief: "HSCTikZBench agent" }
});

export const app = buildApplication(routes, {
  name: "agent",
  localization: {
    loadText: () => ({
      ...text_en,
      exceptionWhileRunningCommand: (exc) =>
        `error: ${exc instanceof Error ? exc.message : String(exc)}`
    })
  }
});

await run(app, process.argv.slice(2), { process });
