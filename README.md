# HSCTikZBench

HSCTikZBench is a benchmark that measures how well multimodal large language models (MLLMs) can reproduce figures from NSW HSC mathematics exams as LaTeX, working in an agentic tool loop.

This repository contains:

- a CLI that prepares, runs and records the benchmark
- a renderer that compiles LaTeX and rasterises PDFs to PNGs
- the dataset manifest that the figure samples are built from
- a web UI for launching, watching, browsing and judging benchmark runs

For more details, see the [project report](<>).

## Dataset

The dataset images are not distributed, for copyright reasons. You can build them yourself from the manifest:

```sh
pnpm cli dataset fetch
pnpm cli dataset build
```

This downloads each exam PDF listed in the manifest into `data/pdfs/`, verifies its checksum, crops every sample out of the PDFs, and verifies each crop's checksum.

The manifest was made with an internal cropping and masking tool, which I'll release once it's polished.

## Usage

Requirements:

- Node 24+
- pnpm 11+
- Podman/Docker/nerdctl or Nix

```sh
pnpm install
pnpm cli --help

# credentials
pnpm cli login openai
pnpm cli login openrouter --type api_key

# individual
pnpm cli run --provider openrouter --model gpt-5.6-luna --reasoning high --out data/runs/gpt-5.6-luna-high data/crops/2020-mathematics_advanced--q-10--figure-1.png

# batch
pnpm cli bench --provider openai --model gpt-5.6-sol --reasoning low --out data/runs/gpt-5.6-sol-low --jobs 4
pnpm cli bench ... --exam 2025-mathematics_extension_1
pnpm cli bench ... --sample 2020-mathematics_advanced--q-5--option-a-1
pnpm cli bench ... --resume

# renderer: local (insecure)
nix profile add .#renderer
pnpm cli bench ... --renderer local

# renderer: docker
nix build .#image && docker load < result
pnpm cli bench ... --renderer docker

# web ui
pnpm dev
pnpm build && pnpm start

# report
pnpm cli report --baseline gpt-5.6-sol-low --json report.json
```

### Nix

```sh
nix build .#hsctikzbench
DATA_DIR=/var/lib/hsctikzbench SESSION_SECRET=... GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... PUBLIC_URL=https://... result/bin/hsctikzbench-web
HSCTIKZBENCH_DATA_DIR=/var/lib/hsctikzbench result/bin/hsctikzbench --help
```

### Judgement

Submissions are judged by humans, who blindly compare two submissions against the reference figure. A Bradley-Terry model fitted to these judgements scores and ranks the model configurations.

The server runs in single-user mode by default. To enable multi-judge mode, set the environment variables `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET` and `PUBLIC_URL`, and create `data/users.json`:

```json
{ "owner": { "role": "owner" }, "judge": { "role": "judge" } }
```
