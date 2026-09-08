#!/usr/bin/env node
// Stands in for `hsctikzbench bench`, run from the web package:
// RUNNER_BENCH_COMMAND="node scripts/fake-bench.mjs" pnpm start
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flags = { exam: [], sample: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  if (key === "resume") flags.resume = true;
  else if (key === "exam" || key === "sample") flags[key].push(args[++i]);
  else flags[key] = args[++i];
}
const manifestPath = path.resolve(process.cwd(), "../dataset/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const slug = (v) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
const stems = [];
for (const exam of manifest) {
  const id = `${exam.year}-${exam.course}`;
  if (flags.exam.length && !flags.exam.includes(id)) continue;
  for (const s of exam.samples) {
    const kind = s.option === undefined ? "figure" : `option-${slug(s.option)}`;
    const stem = `${id}--q-${slug(s.question)}--${kind}-${s.index}`;
    if (flags.sample.length && !flags.sample.includes(stem)) continue;
    stems.push(stem);
  }
}
const maxTurns = Number(flags["max-turns"] ?? 20);
const jobs = Number(flags.jobs ?? 4);
const out = flags.out;
const log = (l) => process.stderr.write(`${l}\n`);
const progressStream = flags["progress-fd"]
  ? createWriteStream("", { fd: Number(flags["progress-fd"]) })
  : null;
progressStream?.on("error", () => {});
const progress = (event) => progressStream?.write(`${JSON.stringify(event)}\n`);
const say = (l) => process.stdout.write(`${l}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log("auth: fake");
log("renderer: fake");
log(`${stems.length} samples, ${jobs} jobs, output in ${out}`);
progress({ type: "start", stems, maxTurns });
let stop = false;
process.on("SIGINT", () => {
  stop = true;
  log("interrupted");
  setTimeout(() => process.exit(130), 200);
});

const png = await readFile(path.resolve(process.cwd(), "../data/crops", `${stems[0]}.png`)).catch(
  () => Buffer.alloc(0)
);
let done = 0;
const outcomes = new Map();
async function runOne(stem) {
  const dir = path.join(out, stem);
  await mkdir(path.join(dir, "renders"), { recursive: true });
  const crop = await readFile(path.resolve(process.cwd(), "../data/crops", `${stem}.png`)).catch(
    () => png
  );
  await writeFile(path.join(dir, "reference.png"), crop);
  const turns = 2 + Math.floor(Math.random() * Math.min(4, maxTurns - 1));
  let cost = 0;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "Reproduce this image." },
        { type: "image", data: "reference.png", mimeType: "image/png" }
      ]
    }
  ];
  for (let t = 1; t <= turns; t++) {
    if (stop) return;
    await sleep(300 + Math.random() * 700);
    cost += 0.003;
    const last = t === turns;
    const name = last ? "submit" : "render";
    const note = `${name}  stop=toolUse  in=${t * 1200} out=${t * 400} cost=$${cost.toFixed(4)}`;
    log(`[${stem}] turn ${t}/${maxTurns}  ${note}`);
    progress({ type: "turn", stem, turn: t, maxTurns, cost, note });
    messages.push({
      role: "assistant",
      content: [
        { type: "text", text: `Turn ${t}: thinking about the figure.` },
        {
          type: "toolCall",
          id: `c${t}`,
          name,
          arguments: last
            ? {}
            : {
                source: `\\documentclass[tikz,border=6pt]{standalone}\n\\begin{document}\n\\begin{tikzpicture}\\draw (0,0)--(${t},1);\\end{tikzpicture}\n\\end{document}`
              }
        }
      ],
      usage: { input: 1200, output: 400 },
      stopReason: "toolUse"
    });
    if (!last) {
      await writeFile(path.join(dir, "renders", `${String(t).padStart(2, "0")}.png`), crop);
      messages.push({
        role: "toolResult",
        toolCallId: `c${t}`,
        toolName: name,
        content: [
          { type: "text", text: `Rendered successfully.\nTurns remaining: ${maxTurns - t}` },
          {
            type: "image",
            data: `renders/${String(t).padStart(2, "0")}.png`,
            mimeType: "image/png"
          }
        ],
        isError: false
      });
    } else {
      messages.push({
        role: "toolResult",
        toolCallId: `c${t}`,
        toolName: name,
        content: [{ type: "text", text: "Submitted." }],
        isError: false
      });
    }
  }
  const status = Math.random() < 0.8 ? "submitted" : "max_turns";
  if (status === "submitted") {
    await writeFile(path.join(dir, "submission.png"), crop);
    await writeFile(path.join(dir, "submission.tex"), "\\documentclass{standalone}\n");
  }
  const result = {
    status,
    provider: "fake",
    model: flags.model ?? "fake",
    reasoning: flags.reasoning ?? "off",
    turns,
    renders: turns - 1,
    successfulRenders: turns - 1,
    usage: { input: 1000, output: 300, cacheRead: 0, cacheWrite: 0, cost },
    durationMs: 1000,
    startedAt: new Date().toISOString()
  };
  await writeFile(
    path.join(dir, "transcript.json"),
    JSON.stringify({ systemPrompt: "fake", messages }, null, 2)
  );
  await writeFile(path.join(dir, "result.json"), JSON.stringify(result, null, 2));
  return { status, turns, cost };
}
const queue = [...stems];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (queue.length && !stop) {
      const stem = queue.shift();
      const r = await runOne(stem);
      if (!r) return;
      outcomes.set(stem, r);
      done++;
      log(
        `[${stem}] ${r.status}  turns=${r.turns} cost=$${r.cost.toFixed(4)}  (${done}/${stems.length})`
      );
      progress({
        type: "done",
        stem,
        outcome: r.status,
        done,
        total: stems.length,
        turns: r.turns,
        cost: r.cost,
        message: null
      });
    }
  })
);
for (const [stem, r] of [...outcomes].sort()) say(`${stem}: ${r.status}  turns=${r.turns}`);
say(`${[...outcomes.values()].filter((r) => r.status === "submitted").length} submitted`);
