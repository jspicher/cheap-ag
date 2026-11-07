import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";
import type { Event } from "@opencode-ai/sdk/v2";
import { killProcessGroup, normalisePath, which } from "./platform.js";
import { modelName, type Limit, type WorkerModel } from "./routing.js";
import type { RunResult, SessionTotals, Usage } from "./worker.js";

/**
 * The Codex engine (docs/codex-worker.md): one `codex exec` thread for one job, behind the same Session shape as
 * OpenCode's (src/worker.ts). Each `run` is one `codex exec` process; the first starts the thread, later ones resume it.
 */

/** The worker rules OpenCode's agent prompt gives (src/opencode.ts), in Codex's terms: no finish tool, no question tool. */
const CODEX_RULES = `You are Cheap Agent's worker. You implement the plan step marked >>> CURRENT STEP(S), in this repository (your working directory, a git worktree made for this job), by editing files yourself.
- Stay within the step's files: and make precise edits. If you must edit anything else, report it under risks.
- Never install packages or run install commands; there is no network. If the step needs a package that is not installed, do what you can without it and name it under missing: step needs package <name>@<range> (not installed).
- Never touch .git, .env* files or lockfiles. Never commit.
- You cannot ask questions. If the step is ambiguous or conflicts with its dont:, take the reading closest to the step and its Source, and name the ambiguity under risks.
- When a Source section is given (the user's request or the issue, verbatim), the step is someone's reading of it: check the step against the source before you start. Implement the step as written, but name every point where they disagree (a direction, an order, a value, an approach the source prefers) under disagree. When the source names a preferred approach or links a fix, implement that one and say so in summary.
- If the step fixes a bug or a wrong behaviour, prove it: first write a small test that reproduces the problem and run it to see it fail, then fix the code and run it again to see it pass. Write the test first, before reading widely. Cover every case the step or Source names or implies; name any case you left out under missing. Keep the test in the change, and run it with the same command the step's checks use.
- The reproduction test asserts the exact values, order and types the source or step states or implies. "Does not crash" or "contains X" is not enough when the expected value is known.
- A command the sandbox refuses is not allowed here: do not try variants; name it under missing.
- When done, end your last message with exactly one fenced block like this, and nothing after it:
\`\`\`cheapag-result
summary: <what you did, at most 160 characters>
risks:
- <assumptions, unverified conditions, edits outside files:>
review:
- <path:start-end worth a human look, at most 5>
missing:
- <anything the step asked for that you did not do>
repro: <the command that runs your reproduction test; "none: <why>" if you could not reproduce it; "n/a" if the step is not a fix>
disagree: <where the step and the Source disagree, or "none">
\`\`\``;

/** Appended to a later prompt that says "call finish": Codex reports through the block instead. */
const FINISH_REMINDER = "You have no finish tool: report as before, ending your last message with the fenced cheapag-result block.";

const INSTALL_HINT = "install it with npm i -g @openai/codex, or set CHEAPAG_CODEX_BIN to the codex binary";

/**
 * How to start Codex: `CHEAPAG_CODEX_BIN`, else `codex` on PATH. A `.js`/`.mjs` file runs with this Node; an npm shim
 * (`codex.cmd` on Windows) is resolved to its codex.js, so no shell is needed.
 */
export function codexCommand(env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] } | { missing: string } {
  const own = env.CHEAPAG_CODEX_BIN;
  const bin = own || which("codex", process.platform, env);
  if (!bin) return { missing: "codex is not on PATH" };
  if (own && !existsSync(own)) return { missing: `CHEAPAG_CODEX_BIN=${own} does not exist` };
  if (/\.[cm]?js$/i.test(bin)) return { file: process.execPath, args: [bin] };
  if (/\.(cmd|bat|ps1)$/i.test(bin) || (process.platform === "win32" && !extname(bin))) {
    const js = join(dirname(bin), "node_modules", "@openai", "codex", "bin", "codex.js");
    return existsSync(js) ? { file: process.execPath, args: [js] } : { missing: `${bin} is a shim without @openai/codex beside it` };
  }
  return { file: bin, args: [] };
}

/**
 * `codex/default`: the model and effort the user's own config.toml names (top level only), since jobs run Codex with
 * `--ignore-user-config`; none named = Codex's built-in default.
 */
function userDefaults(env: NodeJS.ProcessEnv = process.env): { model?: string; effort?: string; windowsSandbox?: string } {
  try {
    const sections = readFileSync(join(env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "utf8").split(/^\s*(?=\[)/m);
    const get = (text: string | undefined, key: string) => text?.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
    const windows = sections.find((s) => /^\[windows\]/.test(s));
    return { model: get(sections[0], "model"), effort: get(sections[0], "model_reasoning_effort"), windowsSandbox: get(windows, "sandbox") };
  } catch {
    return {};
  }
}

/**
 * Seen live on Windows (codex-cli 0.167.0): without `[windows] sandbox`, which `--ignore-user-config` drops,
 * `workspace-write` silently runs read-only. Carry the user's choice, else the one that needs no admin setup.
 */
const sandboxArgs = () => (process.platform === "win32" ? ["-c", `windows.sandbox="${userDefaults().windowsSandbox ?? "unelevated"}"`] : []);

/**
 * Flags every run gets. `--ignore-user-config` drops the user's MCP servers (code must only reach OpenAI) and profile;
 * `--disable hooks` their hooks (seen live: a user hook wrote files into the worktree, which would land). Auth still
 * comes from CODEX_HOME.
 */
const COMMON = [
  "--json", "--ignore-user-config",
  "--disable", "hooks", "--disable", "plugins", "--disable", "apps", "--disable", "memories",
  "-c", 'approval_policy="never"',
];

function modelArgs(m: WorkerModel) {
  if (m.id !== "default") return ["-m", m.id];
  const { model, effort } = userDefaults();
  return [...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : [])];
}

/** A provider limit in Codex's words (a ChatGPT plan's usage limit, or an API rate limit). */
const LIMIT = /usage limit|rate limit|quota|too many requests/i;

type CodexItem = { id: string; type: string; status?: string; command?: string; exit_code?: number | null; changes?: { path: string; kind: string }[]; server?: string; tool?: string; arguments?: unknown; query?: string; text?: string; message?: string };
type CodexEvent = { type: string; thread_id?: string; item?: CodexItem; usage?: Record<string, number>; message?: string; error?: { message?: string } };

const TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

/**
 * A completed tool item as the OpenCode tool part the job layer reads (progress line, turn cap, repro check), with the
 * raw item kept under `codex` for the job log.
 */
function asToolEvent(item: CodexItem, directory: string): Event {
  const rel = (p: string) => normalisePath(isAbsolute(p) ? relative(directory, p) : p);
  const call = item.type === "command_execution" ? { tool: "bash", input: { command: item.command ?? "" } }
    : item.type === "file_change" ? { tool: item.changes?.every((c) => c.kind === "add") ? "write" : "edit", input: { filePath: rel(item.changes?.[0]?.path ?? "") } }
    : item.type === "mcp_tool_call" ? { tool: `${item.server ?? "mcp"}_${item.tool ?? "tool"}`, input: (item.arguments ?? {}) as Record<string, unknown> }
    : { tool: "websearch", input: { query: item.query ?? "" } };
  const failed = item.status === "failed" || item.status === "declined";
  const state = failed ? { status: "error", input: call.input, error: `codex: ${item.status}` } : { status: "completed", input: call.input };
  return { type: "message.part.updated", properties: { part: { type: "tool", id: item.id, callID: item.id, tool: call.tool, state }, codex: item } } as unknown as Event;
}

/** Opens one Codex worker session in `directory` (the job's worktree); the same contract as `openSession`. */
export async function openCodexSession(opts: {
  directory: string;
  model: WorkerModel;
  /** Called with every event, in order: tool items as OpenCode tool parts, everything else as `codex.<type>` (logged only). */
  onEvent: (event: Event, turns: number) => void;
  /** Aborting it kills the running `codex exec` (process tree) and refuses later runs: caps and cancel. */
  signal?: AbortSignal;
}) {
  const { directory } = opts;
  let thread: string | undefined;
  let turns = 0;
  const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
  const models = new Set<string>();

  async function run(prompt: string, model?: WorkerModel, interrupt?: AbortSignal, afterStop = false): Promise<RunResult> {
    const signal = afterStop ? undefined : opts.signal;
    if (signal?.aborted) return { text: "", error: "aborted" };
    const cmd = codexCommand();
    if ("missing" in cmd) return { text: "", error: `Codex CLI not found (${cmd.missing}); ${INSTALL_HINT}` };
    const m = model?.providerID === "codex" ? model : opts.model;
    models.add(modelName(m));
    const args = thread
      ? [...cmd.args, "exec", "resume", thread, ...COMMON, "-c", 'sandbox_mode="workspace-write"', ...sandboxArgs(), ...modelArgs(m), "-"]
      : [...cmd.args, "exec", ...COMMON, "-s", "workspace-write", ...sandboxArgs(), "-C", directory, ...modelArgs(m), "-"];
    const text = thread ? (/\bcall finish\b/.test(prompt) ? `${prompt}\n\n${FINISH_REMINDER}` : prompt) : `${CODEX_RULES}\n\n${prompt}`;

    return new Promise<RunResult>((resolve) => {
      // POSIX: its own process group, so a stop kills codex.js and the native binary under it together
      const child = spawn(cmd.file, args, { cwd: directory, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let last = "";
      let error: string | undefined;
      let limit: Limit | undefined;
      let completed = false;
      let settled = false;
      const stderr: string[] = [];
      const stop = () => killProcessGroup(child.pid, "SIGKILL");
      signal?.addEventListener("abort", stop, { once: true });
      interrupt?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted || interrupt?.aborted) stop();

      const finish = (result: RunResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", stop);
        interrupt?.removeEventListener("abort", stop);
        resolve(result);
      };

      createInterface({ input: child.stdout }).on("line", (line) => {
        let event: CodexEvent;
        try {
          event = JSON.parse(line) as CodexEvent;
        } catch {
          return; // not an event (Codex prints only JSONL with --json; anything else is noise)
        }
        const item = event.item;
        if (event.type === "thread.started" && event.thread_id) thread = event.thread_id;
        else if (event.type === "item.completed" && item && TOOL_ITEMS.has(item.type)) {
          turns++; // one completed tool call is one turn, as OpenCode's tool parts are counted
          opts.onEvent(asToolEvent(item, directory), turns);
          return;
        } else if (event.type === "item.completed" && item?.type === "agent_message") last = item.text ?? "";
        else if (event.type === "turn.completed") {
          completed = true;
          const u = event.usage ?? {};
          const cached = u.cached_input_tokens ?? 0;
          usage.inputTokens += Math.max(0, (u.input_tokens ?? 0) - cached);
          usage.cacheRead += cached;
          usage.cacheWrite += u.cache_write_input_tokens ?? 0;
          usage.outputTokens += u.output_tokens ?? 0;
          usage.reasoningTokens += u.reasoning_output_tokens ?? 0;
        } else if (event.type === "turn.failed" || event.type === "error") {
          const message = event.error?.message ?? event.message ?? "codex turn failed";
          error ??= message;
          if (LIMIT.test(message)) limit ??= { model: modelName(m), message, next: Number.NaN };
        }
        opts.onEvent({ type: `codex.${event.type}`, properties: event } as unknown as Event, turns);
      });
      createInterface({ input: child.stderr }).on("line", (line) => {
        if (line.trim()) stderr.splice(0, Math.max(0, stderr.length - 4), line.trim());
      });
      child.stdin.on("error", () => {}); // a binary that exits at once closes stdin under us
      child.stdin.end(text);

      child.on("error", (err) => finish({ text: "", error: `Codex CLI could not start (${err.message}); ${INSTALL_HINT}` }));
      child.on("close", (code) => {
        // an interrupt ends this prompt only: the thread stays resumable
        if (interrupt?.aborted && !signal?.aborted) return finish({ text: last, interrupted: true });
        if (signal?.aborted) return finish({ text: last, error: "aborted" });
        if (!completed) error ??= `codex exited with code ${code}${stderr.length ? `: ${stderr.at(-1)}` : ""}`;
        finish({ text: last, ...(error && { error }), ...(limit && { limit }) });
      });
    });
  }

  function totals(): SessionTotals {
    // a ChatGPT plan has no per-call price, so Codex usage costs $0 here (docs/codex-worker.md); the ledger skips it
    return { sessionID: thread ?? "", turns, usage: { ...usage }, rejections: [], spend: Object.fromEntries([...models].map((m) => [m, 0])) };
  }

  return {
    get sessionID() {
      return thread ?? "";
    },
    run,
    totals,
  };
}
