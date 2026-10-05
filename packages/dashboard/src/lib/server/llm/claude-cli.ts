import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ashHome } from "@ash/contract/legacy-env";

/**
 * Drives the locally installed Claude Code CLI in headless mode, so a user with
 * a Claude subscription and no API key still gets a real model.
 *
 * Why spawn the CLI instead of reusing its credentials: the stored OAuth token
 * is scoped to `user:sessions:claude_code`. Lifting it and calling the API
 * directly would be both a terms violation and technically wrong — the CLI *is*
 * the licensed client, so we drive the client.
 *
 * SECURITY. This endpoint turns chat input into a subprocess, so the subprocess
 * gets nothing to work with:
 *
 *  - `permissions.deny: ["*"]` is deny-by-default, verified to leave the model
 *    with zero tools. A denylist of tool names was rejected: the built-in
 *    roster changes between CLI releases, so a name list silently rots into a
 *    hole on the next upgrade.
 *  - `--strict-mcp-config` with no config drops every MCP server the user has
 *    configured — including the ASH payment tools, which must never be
 *    reachable from a chat box.
 *  - cwd is an empty directory, so no CLAUDE.md or repo file is in scope.
 *  - the model is chosen from a fixed map, never from request text.
 */

export const CLAUDE_CLI_MODELS = {
  "claude-cli:opus": "opus",
  "claude-cli:sonnet": "sonnet",
  "claude-cli:haiku": "haiku",
} as const;

export type ClaudeCliModel = keyof typeof CLAUDE_CLI_MODELS;

export function isClaudeCliModel(id: string): id is ClaudeCliModel {
  return Object.hasOwn(CLAUDE_CLI_MODELS, id);
}

const SANDBOX_SETTINGS = JSON.stringify({
  permissions: { deny: ["*"], defaultMode: "manual" },
});

/** An empty cwd so the CLI cannot pick up project context or instructions. */
async function sandboxDir(): Promise<string> {
  const dir = join(ashHome(), "chat-sandbox");
  await mkdir(dir, { recursive: true });
  return dir;
}

export type ClaudeCliOptions = {
  prompt: string;
  systemPrompt: string;
  model: ClaudeCliModel;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Streams assistant text deltas as they arrive from the CLI. */
export async function* streamClaudeCli(
  options: ClaudeCliOptions,
): AsyncGenerator<string, void, unknown> {
  const { prompt, systemPrompt, model, signal, timeoutMs = 120_000 } = options;
  const cwd = await sandboxDir();

  const child = spawn(
    "claude",
    [
      "-p",
      prompt,
      "--system-prompt",
      systemPrompt,
      "--settings",
      SANDBOX_SETTINGS,
      "--strict-mcp-config",
      "--model",
      CLAUDE_CLI_MODELS[model],
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ],
    {
      cwd,
      // Inherit PATH so the binary resolves, but never hand it an API key —
      // the whole point of this path is to use the subscription.
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const kill = () => child.kill("SIGTERM");
  const timer = setTimeout(kill, timeoutMs);
  signal?.addEventListener("abort", kill, { once: true });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exited = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 0)));

  try {
    let buffer = "";
    let sawText = false;
    let lastYielded = "";

    const emit = function* (text: string | null): Generator<string, void, unknown> {
      if (!text || text === lastYielded) return;
      lastYielded = text;
      sawText = true;
      yield text;
    };

    for await (const chunk of child.stdout) {
      buffer += (chunk as Buffer).toString();
      const lines = buffer.split("\n");
      // The last element is whatever has not been terminated yet.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        yield* emit(extractStreamLine(line, sawText));
      }
    }

    if (buffer.trim()) {
      yield* emit(extractStreamLine(buffer, sawText));
    }

    const code = await exited;
    if (!sawText) {
      throw new Error(
        code === 0
          ? "Claude Code returned no text."
          : `Claude Code exited with code ${code}. ${firstLine(stderr)}`,
      );
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", kill);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

/**
 * Claude Code `stream-json` emits several line shapes. Streaming deltas use
 * `stream_event`; rate limits and other API errors arrive as `assistant` or
 * `result` lines instead — ignoring those produced the opaque "exit code 1".
 */
function extractStreamLine(line: string, sawStreamingText: boolean): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const event = parsed as {
    type?: string;
    error?: string;
    is_api_error_message?: boolean;
    is_error?: boolean;
    result?: string;
    event?: { type?: string; delta?: { type?: string; text?: string } };
    message?: { content?: { type?: string; text?: string }[] };
  };

  if (event.type === "stream_event") {
    if (event.event?.type !== "content_block_delta") return null;
    if (event.event.delta?.type !== "text_delta") return null;
    return event.event.delta.text ?? null;
  }

  if (event.type === "assistant" && (event.error || event.is_api_error_message)) {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text) return block.text;
    }
  }

  if (event.type === "result" && typeof event.result === "string") {
    if (event.is_error === true) return event.result;
    if (!sawStreamingText) return event.result;
  }

  return null;
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim()) ?? "";
}
