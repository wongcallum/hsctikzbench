# HSCTikZBench

HSCTikZBench is a benchmark that measures various MLLMs (multimodal large language model) ability to reproduce figures from NSW HSC mathematics exams as LaTeX code in an agentic tool loop.

This repository includes a CLI which prepares, runs and records the benchmark, a renderer program which compiles LaTeX and rasterises PDFs to PNGs, the dataset manifest which figure samples are built from, and a web UI which allows humans to launch, watch, browse, and judge benchmark runs.

For more details, please read the project report [here](<>).

## Dataset

We have not distributed the dataset in the form of image data, this is due to copyright constraints. This doesn't stop you from running the benchmark, however, because it is trivial to build the dataset from the dataset manifest:

```sh
pnpm cli dataset fetch
pnpm cli dataset build
```

This downloads each PDF from the manifest into `data/pdfs/`, checks each PDF against their expected checksum in the manifest, crops every sample out of the PDFs, and then checks each sample against their expected checksum.

The manifest was created with an internal cropping and masking tool, which I will make available after some polishing.

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
```

### Judgement

This repository is built around a multi-judge model, where judges (including the owner) can individually pass, fail or flag for review each run assigned to them, and conflicts are resolved in a separate interface by the owner. However, the development server runs in a single-user mode by default. To enable multi-judge mode, set the environment variables `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET` and `PUBLIC_URL`, and create `web/users.json`:

```json
{ "owner": { "role": "owner" }, "judge": { "role": "judge" } }
```
