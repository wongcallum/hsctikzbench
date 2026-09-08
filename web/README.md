# HSCTikZBench web

One server and one UI for launching `hsctikzbench bench`, watching it work, and judging
the results: a live log, per-sample progress, renders and submissions next to the
reference crop, the transcript of each run, and the blind judging pages.

## Run

Development, with hot reload for the UI (from the repository root):

```sh
pnpm dev          # API on :8787, UI on the vite URL it prints
```

Production, one process serving both:

```sh
pnpm build
pnpm start        # http://127.0.0.1:8787
```

Credentials come from `cli/auth.json` or the provider's environment variable, exactly as
for the CLI. Log in with `pnpm --filter hsctikzbench-cli start login <provider>`.

## Environment

| Variable               | Default                    | Meaning                                                                                                               |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `RUNS_DIR`             | `../data/runs`             | Where batches are written and read from                                                                               |
| `CROPS_DIR`            | `../data/crops`            | Reference crops from `dataset build`                                                                                  |
| `MANIFEST`             | `../dataset/manifest.json` | Sample listing                                                                                                        |
| `AUTH_FILE`            | `../cli/auth.json`         | Credentials file for listing configured providers                                                                     |
| `RUNNER_STATE_DIR`     | `./state`                  | Job records and logs                                                                                                  |
| `PORT` / `HOST`        | `8787` / `127.0.0.1`       | Where the server listens                                                                                              |
| `RUNNER_BENCH_COMMAND` |                            | Replace the bench command, e.g. `node scripts/fake-bench.mjs` to try the UI without a model; runs from this directory |

Paths are relative to this directory.

## How it works

- **Jobs** are bench invocations. Each is spawned as `tsx src/cli.ts bench …` inside `cli/`
  with `--progress-fd 3`, so the bench reports each turn and each finished sample as JSON
  events on a pipe of their own while its stdout and stderr are captured line by line. All
  three land in `state/jobs/<id>/log.jsonl`, and `job.json` tracks the job's status. The log
  is streamed to the browser over server-sent events. If a bench prints no events (an
  override that predates them), the `[stem] turn i/N …` lines are scraped instead.
- **Batches** are output directories under `RUNS_DIR`. The UI lists every one it finds,
  whether or not this server started it, and reads `result.json`, `renders/`,
  `submission.png`, `submission.tex` and `transcript.json` from each run directory.
- **Judging** lists every run of every sample under an id derived from its batch and stem.
  The judge page asks for the blind listing, which carries neither batch names nor model
  names; the view page shows everything. A verdict is written to `judgement.json` in the
  run directory.
- **Run options** (provider, model, reasoning, turns, parallelism, renderer, resume and
  the sample selection) are remembered in the browser's local storage; the batch name is
  not. _New run like this_ on a batch opens the form with that batch's options instead,
  taken from its job record or, for batches made outside the UI, from its results.
- **Stopping** a job sends SIGINT so the CLI can remove any renderer containers, then
  SIGKILL after 15 seconds. Stopping the server itself does the same for every running job
  and records them as interrupted. Relaunch the same batch with _resume_ on to finish what
  was interrupted.

The server holds no state the benchmark needs; deleting `state/` only forgets the logs and
job records, not the runs or judgements.
