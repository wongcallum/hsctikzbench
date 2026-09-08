import { createHash } from "node:crypto";
import {
  Type,
  retryAssistantCall,
  validateToolCall,
  type Context,
  type Model,
  type ModelThinkingLevel,
  type Models,
  type Api,
  type Tool,
  type ToolCall,
  type ToolResultMessage
} from "@earendil-works/pi-ai";
import { pngSize, render, type RenderResult } from "./render.ts";
import type { Renderer } from "./renderer.ts";
import {
  OutputDir,
  REFERENCE_FILE,
  type RunResult,
  type RunStatus,
  type Submission
} from "./output.ts";

const tools: Tool[] = [
  {
    name: "render",
    description:
      "Compile a complete LaTeX document with lualatex and return the rendered page as a PNG image. On failure, returns the compiler error instead.",
    parameters: Type.Object({
      source: Type.String({
        description: "The full LaTeX document, from \\documentclass to \\end{document}."
      })
    })
  },
  {
    name: "submit",
    description:
      "Submit your most recent render as the final answer and end the session. Only allowed when your most recent render succeeded.",
    parameters: Type.Object({})
  }
];

const PROVIDER_RETRIES = 3;
const PROVIDER_RETRY_BASE_MS = 5_000;

export interface RunOptions {
  models: Models;
  model: Model<Api>;
  reasoning: ModelThinkingLevel;
  renderer: Renderer;
  maxTurns: number;
  systemPrompt: string;
  referencePng: Buffer;
  out: OutputDir;
  log: (line: string) => void;
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { models, model, out, log, maxTurns } = opts;
  const startedAt = new Date();
  const fit = pngSize(opts.referencePng);
  const imageNames = new Map<string, string>();
  const referenceB64 = opts.referencePng.toString("base64");
  imageNames.set(referenceB64, REFERENCE_FILE);

  const context: Context = {
    systemPrompt: opts.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Reproduce this image." },
          { type: "image", data: referenceB64, mimeType: "image/png" }
        ],
        timestamp: Date.now()
      }
    ],
    tools
  };

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let turns = 0;
  let renders = 0;
  let successfulRenders = 0;
  let lastGoodRender: Submission | undefined;
  let status: RunStatus | undefined;
  let error: string | undefined;
  let submission: Submission | undefined;

  const remaining = () => `Turns remaining: ${maxTurns - turns}`;
  const toolResult = (
    call: ToolCall,
    text: string,
    isError: boolean,
    image?: Buffer
  ): ToolResultMessage => {
    const content: ToolResultMessage["content"] = [
      { type: "text", text: `${text}\n${remaining()}` }
    ];
    if (image)
      content.push({ type: "image", data: image.toString("base64"), mimeType: "image/png" });
    return {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content,
      isError,
      timestamp: Date.now()
    };
  };
  const nudge = (text: string) =>
    context.messages.push({ role: "user", content: text, timestamp: Date.now() });
  const complete = () =>
    models.completeSimple(
      model,
      context,
      opts.reasoning === "off" ? {} : { reasoning: opts.reasoning }
    );

  try {
    while (turns < maxTurns) {
      turns++;

      const reply = await retryAssistantCall(
        complete,
        { enabled: true, maxRetries: PROVIDER_RETRIES, baseDelayMs: PROVIDER_RETRY_BASE_MS },
        undefined,
        {
          onRetryScheduled: (attempt, maxAttempts, delay, message) =>
            log(
              `turn ${turns}/${maxTurns}  provider error: ${message}; retry ${attempt}/${maxAttempts} in ${delay / 1000}s`
            )
        }
      );
      context.messages.push(reply);

      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      usage.cacheRead += reply.usage.cacheRead;
      usage.cacheWrite += reply.usage.cacheWrite;
      usage.cost += reply.usage.cost.total;

      if (reply.stopReason === "error") {
        status = "error";
        error = reply.errorMessage ?? "provider returned an error";
        log(`turn ${turns}/${maxTurns}  error: ${error}`);
        break;
      }

      const calls = reply.content.filter((b): b is ToolCall => b.type === "toolCall");
      const summary = calls.length === 0 ? "(no tool call)" : calls.map((c) => c.name).join("+");
      log(
        `turn ${turns}/${maxTurns}  ${summary}  stop=${reply.stopReason}  in=${usage.input} out=${usage.output} cost=$${usage.cost.toFixed(4)}`
      );

      if (reply.stopReason === "length") {
        nudge(
          `Your reply was cut off by the output limit. Reply with a single tool call: render or submit. ${remaining()}`
        );
        continue;
      }
      if (calls.length === 0) {
        nudge(`Reply with a single tool call: render or submit. ${remaining()}`);
        continue;
      }
      if (calls.length > 1) {
        for (const call of calls)
          context.messages.push(
            toolResult(call, "Only one tool call per reply is allowed. None were executed.", true)
          );
        continue;
      }

      const call = calls[0]!;
      try {
        validateToolCall(tools, call);
      } catch (e) {
        context.messages.push(
          toolResult(call, `Invalid tool call: ${e instanceof Error ? e.message : String(e)}`, true)
        );
        continue;
      }

      if (call.name === "render") {
        const source = String(call.arguments["source"]);
        renders++;
        const result: RenderResult = await render(opts.renderer, source, fit);
        if (result.ok) {
          successfulRenders++;
          const name = await out.saveRender(renders, result.png);
          imageNames.set(result.png.toString("base64"), name);
          lastGoodRender = { source, png: result.png };
          context.messages.push(toolResult(call, "Rendered successfully.", false, result.png));
        } else {
          lastGoodRender = undefined;
          context.messages.push(toolResult(call, `Render failed:\n${result.message}`, true));
        }
        continue;
      }

      // submit
      if (!lastGoodRender) {
        context.messages.push(
          toolResult(
            call,
            "Nothing to submit: your most recent render did not succeed. Fix it and render again first.",
            true
          )
        );
        continue;
      }
      submission = lastGoodRender;
      context.messages.push(toolResult(call, "Submitted.", false));
      status = "submitted";
      break;
    }
  } catch (e) {
    // e.g. the renderer backend became unavailable mid-run. Keep whatever transcript we
    // have rather than losing the run.
    status = "error";
    error = e instanceof Error ? e.message : String(e);
    log(`turn ${turns}/${maxTurns}  crashed: ${error}`);
  }

  const result: RunResult = {
    status: status ?? "max_turns",
    error,
    provider: model.provider,
    model: model.id,
    reasoning: opts.reasoning,
    turns,
    renders,
    successfulRenders,
    usage,
    durationMs: Date.now() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    harness: {
      renderer: opts.renderer.description,
      fit: `${fit.width}x${fit.height}`,
      referenceSha256: createHash("sha256").update(opts.referencePng).digest("hex"),
      promptSha256: createHash("sha256").update(opts.systemPrompt).digest("hex"),
      maxTurns
    }
  };

  await out.finish(result, context, imageNames, submission);
  return result;
}
