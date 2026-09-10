import { appendFile, readFile, writeFile } from "node:fs/promises";
import { Codex } from "@openai/codex-sdk";

const reasoningLevels = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export function parseCodexArgs(argv, { positional = "many" } = {}) {
  const values = [];
  let model = process.env.ROAST_CODEX_MODEL || "gpt-5.6-sol";
  let reasoning = process.env.ROAST_CODEX_REASONING || "medium";

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--model" || value === "-m") {
      model = argv[++index] ?? "";
    } else if (value.startsWith("--model=")) {
      model = value.slice("--model=".length);
    } else if (value === "--reasoning") {
      reasoning = argv[++index] ?? "";
    } else if (value.startsWith("--reasoning=")) {
      reasoning = value.slice("--reasoning=".length);
    } else {
      values.push(value);
    }
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error(`Invalid Codex model: ${model}`);
  if (!reasoningLevels.has(reasoning)) throw new Error(`Invalid Codex reasoning effort: ${reasoning}`);
  return { model, reasoning, values: positional === "one" ? values.slice(0, 1) : values };
}

export async function createCodexThread({
  workingDirectory,
  model,
  reasoning,
  sandboxMode,
  networkAccessEnabled = false,
  skipGitRepoCheck = false,
  isolated = false,
  threadId,
}) {
  const codex = new Codex(isolated ? {
    config: {
      features: {
        apps: false,
        browser_use: false,
        computer_use: false,
        image_generation: false,
        multi_agent: false,
        plugins: false,
        skill_search: false,
        workspace_dependencies: false,
      },
    },
  } : undefined);
  const options = {
    workingDirectory,
    model,
    modelReasoningEffort: reasoning,
    sandboxMode,
    networkAccessEnabled,
    skipGitRepoCheck,
    webSearchMode: "disabled",
    webSearchEnabled: false,
    approvalPolicy: "never",
  };
  const thread = threadId ? codex.resumeThread(threadId, options) : codex.startThread(options);
  return { codex, thread };
}

export async function runCodexTurn({
  thread,
  prompt,
  outputSchemaPath,
  eventsPath,
  timeoutMs = 10 * 60_000,
  idleTimeoutMs = 5 * 60_000,
  onProgress,
}) {
  const outputSchema = outputSchemaPath
    ? JSON.parse(await readFile(outputSchemaPath, "utf8"))
    : undefined;
  const controller = new AbortController();
  let abortReason = "";
  let idleTimer;
  const totalTimer = setTimeout(() => {
    abortReason = `Codex exceeded the ${Math.round(timeoutMs / 60_000)} minute idea-development limit`;
    controller.abort();
  }, timeoutMs);
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = `Codex produced no progress event for ${Math.round(idleTimeoutMs / 1_000)} seconds`;
      controller.abort();
    }, idleTimeoutMs);
  };

  const items = [];
  let finalResponse = "";
  let usage = null;
  let turnFailure = null;
  if (eventsPath) await writeFile(eventsPath, "");
  resetIdleTimer();

  try {
    const { events } = await thread.runStreamed(prompt, { ...(outputSchema ? { outputSchema } : {}), signal: controller.signal });
    for await (const event of events) {
      resetIdleTimer();
      if (eventsPath) await appendFile(eventsPath, `${JSON.stringify(event)}\n`);
      onProgress?.(event);
      if (event.type === "item.completed") {
        items.push(event.item);
        if (event.item.type === "agent_message") finalResponse = event.item.text;
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        turnFailure = event.error;
        break;
      } else if (event.type === "error") {
        turnFailure = { message: event.message };
        break;
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(abortReason || "Codex idea development was cancelled", { cause: error });
    throw error;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }

  if (turnFailure) throw new Error(turnFailure.message);
  if (!finalResponse.trim()) throw new Error("Codex SDK returned an empty final response.");
  return { items, finalResponse, usage };
}

export async function readThreadId(pathname) {
  const value = await readFile(pathname, "utf8").then(JSON.parse).catch(() => null);
  return typeof value?.threadId === "string" ? value.threadId : undefined;
}

export async function saveThreadMetadata(pathname, { thread, model, reasoning }) {
  await writeFile(pathname, `${JSON.stringify({
    threadId: thread.id,
    model,
    reasoning,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}
