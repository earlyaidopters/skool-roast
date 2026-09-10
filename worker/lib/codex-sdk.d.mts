import type { Thread, ThreadEvent, Usage, ThreadItem } from "@openai/codex-sdk";
export function parseCodexArgs(argv: string[], opts?: { positional?: "many" | "one" }): { model: string; reasoning: string; values: string[] };
export function createCodexThread(opts: {
  workingDirectory: string;
  model: string;
  reasoning: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  networkAccessEnabled?: boolean;
  skipGitRepoCheck?: boolean;
  isolated?: boolean;
  threadId?: string;
}): Promise<{ codex: unknown; thread: Thread }>;
export function runCodexTurn(opts: {
  thread: Thread;
  prompt: unknown;
  outputSchemaPath?: string;
  eventsPath?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  onProgress?: (event: ThreadEvent) => void;
}): Promise<{ items: ThreadItem[]; finalResponse: string; usage: Usage | null }>;
export function readThreadId(pathname: string): Promise<string | undefined>;
export function saveThreadMetadata(pathname: string, meta: { thread: Thread; model: string; reasoning: string }): Promise<void>;
