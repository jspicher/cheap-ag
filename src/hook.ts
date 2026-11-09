import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { loadConfig, userConfigFile } from "./config.js";
import { baseVersion } from "./version.js";
import { projectRoot } from "./workspace.js";

const USAGE = "usage: cheapag hook [on | off]";
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "apply_patch", "Bash"]);
// Bash forms that write a file: redirects and heredocs into a path, in-place sed/perl, tee, cp/mv targets, and
// python/node one-liners that open files for writing. The benchmark showed Claude writing whole files this way.
const BASH_WRITES = [
  /(?:^|[^<>])>{1,2}\s*(?!&)["']?(?<path>[^\s"'|;&]+)/g,
  /\btee\s+(?:-a\s+)?["']?(?<path>[^\s"'|;&]+)/g,
  /\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+["']?(?<path>[^\s"'|;&]+)/g,
];
// in-place edits name their files after the script, so they are denied as a whole (plan files are never edited this way)
const BASH_INPLACE = /\b(?:sed|perl)\s+(?:-[a-zA-Z]*i|--in-place)\b/;
const BASH_CODE_WRITES = /\b(?:python3?|node)\s+-[ce]\b[\s\S]*(?:open\([^)]*["'][wa]|writeFile|writeFileSync|\.write_text)/;
// the plugin's server and a `cheapag login` registration give the tool different prefixes, so name both
const REDIRECT = "write a plan step and use the cheapag server's delegate tool (mcp__plugin_cheapag_cheapag__delegate, or mcp__cheapag__delegate) instead.";
const CHEAPAG_TOOL = /^mcp__(?:plugin_cheapag_)?cheapag__/;
// a job block's first word means the worker did not finish the step (the server's FAIL/PARTIAL/TIMEOUT)
const NOT_DONE = /^(?:FAIL|PARTIAL|TIMEOUT) j\w+ /;
// an OK whose checks passed in the worker's worktree (ticket 30: re-running them caught nothing)
const OK_PASSED = /^OK j\w+ step=\S+ .*\btests=pass\b/m;
// shortcut: the usual runners only; add the repo's test_cmd if Claude re-runs tests through a custom script
const TEST_CMD = /swebench-test\.sh|\bpytest\b|runtests\.py|bin\/test\b|\b(?:npm|pnpm|yarn|bun) (?:run )?test\b|node --test|\btox\b|\bvitest\b|\bjest\b|\bgo test\b|\bcargo test\b|\b(?:mvn|gradle|gradlew) test\b|\brspec\b|\bphpunit\b|-m unittest\b|\bmake test\b/;
// sonnet take-over: reads are how the subagent (or Claude) inspects the worker's diff before handing it over
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);
// asking the user and loading a tool are free in both take-over modes (ticket 51)
const ASK_TOOLS = new Set(["AskUserQuestion", "ToolSearch"]);
// the desktop app's own tools, e.g. mcp__ccd_turn__wrap_up, are the user's session, not the repo
const DESKTOP_TOOL = "mcp__ccd_";
// edits outside the repo cannot touch the worker's worktree, so the taker may make them (the Sonnet branch only)
const OUTSIDE_EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_PARTS = ["git diff", "git log", "git show", "git status", "cat", "head", "tail", "ls", "grep", "rg", "wc", "find", "pwd", "echo"];

/** Presence of this file under `.cheapag/` turns the guard on for the repo; it ships off (spec A6). */
const flag = (root: string) => join(root, ".cheapag", "hook.json");

/**
 * `cheapag hook [on|off]`: the user-only `/cheapag:hook` toggles the edit guard for the current repo; no argument
 * shows its state. `cheapag hook guard` is the plugin's PreToolUse hook (spec E6); `cheapag hook result` its PostToolUse
 * hook on cheapag's own tools, which starts the take-over budget (ticket 29).
 */
export function hook(args: string[]): number | Promise<number> {
  if (args.length === 1 && args[0] === "guard") return guard();
  if (args.length === 1 && args[0] === "context") return context();
  if (args.length === 2 && args[0] === "context" && args[1] === "codex") return context("codex");
  if (args.length === 1 && args[0] === "result") return result();
  const out = (line: string) => process.stdout.write(line + "\n");
  if (args.length > 1 || (args.length && args[0] !== "on" && args[0] !== "off")) {
    out(`✗ ${USAGE}`);
    return 1;
  }
  let root: string;
  try {
    root = projectRoot(process.cwd());
  } catch (err) {
    out(`✗ ${(err as Error).message}`);
    return 1;
  }
  if (args[0] === "on") {
    mkdirSync(join(root, ".cheapag"), { recursive: true });
    writeFileSync(flag(root), JSON.stringify({ on: true }) + "\n");
  } else if (args[0] === "off") rmSync(flag(root), { force: true });
  let lines: number | string;
  try {
    lines = loadConfig(root).guard_lines;
  } catch (err) {
    lines = `? (${(err as Error).message})`;
  }
  out(existsSync(flag(root))
    ? `✓ edit guard on for ${root}: an edit over ${lines} changed lines, a 3rd edit to one file in a turn, or a Bash command writing a file is denied with a pointer to delegate (.plan/ is exempt). CHEAPAG_ALLOW_EDITS=1 bypasses it.`
    : `✓ edit guard off for ${root}: Claude's edits are not limited.`);
  return 0;
}

/**
 * The plugin's SessionStart hook: one line pointing at delegate. The rules live in the server instructions only, since
 * this context lands after Claude Code's cache breakpoint and is rewritten every session (ticket 24.2).
 */
export const SESSION_CONTEXT = `Cheap Agent requires an explicit user request for the current task; connection and consent are not authorization.`;

const { version: INSTALLED } = createRequire(import.meta.url)("../package.json") as { version: string };
const UPDATE_URL = "https://registry.npmjs.org/cheap-agent/latest";
// once a day is enough for a notice the user cannot act on mid-session (Claude Code's own check is the same shape)
const DAY_MS = 24 * 60 * 60 * 1000;
const updateCacheFile = () => join(dirname(userConfigFile()), "update-check.json");
type UpdateCache = { checked?: number; latest?: string };

/** Both hosts start quietly. An explicitly enabled update check may emit a system notice. */
async function context(_host?: "claude" | "codex"): Promise<number> {
  const latest = await newerVersion();
  if (!latest) return 0;
  process.stdout.write(JSON.stringify({ systemMessage: `Upstream Cheap Agent ${latest} is available; this fork is ${INSTALLED}. Review the fork release notes before updating.` }) + "\n");
  return 0;
}

/** The newer version to announce, or undefined when the installed version is current (or the check is opted out). */
async function newerVersion(): Promise<string | undefined> {
  if (process.env.CHEAPAG_UPDATE_CHECK !== "1" || process.env.CHEAPAG_NO_UPDATE_CHECK === "1") return;
  const latest = await latestVersion();
  // on the published base: a fork build (1.3.2-js.1) is as current as its base, and older than nothing it is built on
  if (!latest || !majorOrMinorNewer(latest, baseVersion(INSTALLED))) return;
  return latest;
}

/**
 * The registry's latest version, cached next to the user config for a day. A fresh cache is used as-is with no network
 * call; a stale one is refreshed with a 1.5 s timeout, and any failure still writes the new `checked` time (with the
 * old latest) so an offline machine does not retry on every session.
 */
async function latestVersion(): Promise<string | undefined> {
  const file = updateCacheFile();
  let cache: UpdateCache = {};
  try {
    cache = JSON.parse(readFileSync(file, "utf8")) as UpdateCache;
  } catch {
    // no usable cache: check now
  }
  if (typeof cache.checked === "number" && Date.now() - cache.checked < DAY_MS) return cache.latest || undefined;
  let latest = cache.latest || undefined;
  try {
    const res = await fetch(UPDATE_URL, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === "string") latest = body.version;
  } catch {
    // offline, slow or malformed: keep the old latest (or none)
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ checked: Date.now(), latest: latest ?? "" }));
  } catch {
    // the notice must never break the session
  }
  return latest;
}

/** True when `release` is a newer major or minor than `installed`; a patch-only bump is ignored, as is any non x.y.z. */
function majorOrMinorNewer(release: string, installed: string): boolean {
  const [a, b] = [nums(release), nums(installed)];
  if (!a || !b) return false;
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

/** A version as numbers, only when it is exactly x.y.z; anything else (a tag, a range) is ignored. */
function nums(v: string): readonly [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/**
 * Reads Claude Code's PreToolUse JSON on stdin; prints a deny decision or nothing (no decision: the normal permission
 * flow applies, so the guard never approves anything). Any error allows: a broken guard must never block editing.
 */
function guard(): number {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const reason = budget(input) ?? check(input);
    if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }) + "\n");
  } catch {
    // allow
  }
  return 0;
}

// agent_id is set only on a subagent's calls (seen live on Claude Code 2.1.285); the prompt rules never count or deny them
type Input = { session_id?: string; prompt_id?: string; agent_id?: string; cwd?: string; tool_name?: string; tool_input?: Record<string, unknown>; tool_response?: unknown };
/** What this user prompt's cheapag results were: the worker did not finish a step (and Claude's calls since), or an OK passed its checks. */
type PromptState = { prompt: string; delegated?: boolean; calls: number; notDone?: boolean; okPassed?: boolean };

/** Per-session state; the repo-wide marker lets the plugin's shell test skip node until a cheapag result was ever seen. */
const stateFile = (root: string, session: string) => join(root, ".cheapag", "hook", `${session.replace(/[^\w-]/g, "_")}.takeover.json`);
const marker = (root: string) => join(root, ".cheapag", "hook", "takeover");

/**
 * The prompt rules (tickets 29, 30, 51), for the main loop only:
 * - after a FAIL, PARTIAL or TIMEOUT, takeover "ask" (the default) allows only reads, one AskUserQuestion, tool loading
 *   and the desktop app's tools; "sonnet" leaves the Agent tool (to hand the step to a Sonnet subagent), reads, the same
 *   asking/loading tools and cheapag's tools; "self" denies the call after limits.takeover_calls (resolved take-overs
 *   used at most 13).
 * - after an OK whose checks passed, re-running tests is denied: unverified OKs were as correct as verified ones.
 * A new user prompt clears both. cheapag's own tools and a subagent's calls are never counted or denied.
 */
function budget(input: Input): string | undefined {
  if (!input.session_id || !input.prompt_id || input.agent_id || typeof input.cwd !== "string" || CHEAPAG_TOOL.test(input.tool_name ?? "")) return;
  const roots = targetRoots(input);
  for (const root of roots) { const reason = budgetAt(input, root); if (reason) return reason; }
}

function budgetAt(input: Input, root: string): string | undefined {
  const file = stateFile(root, input.session_id!);
  let state: PromptState;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return; // no cheapag result in this session yet
  }
  if (state.prompt !== input.prompt_id || !state.delegated) return; // a new user prompt starts fresh
  const config = loadConfig(root);
  if (state.notDone && config.takeover === "ask") {
    if (input.tool_name === "AskUserQuestion") {
      // the user is being asked: whatever they pick is theirs
      writeFileSync(file, JSON.stringify({ ...state, notDone: undefined } satisfies PromptState));
      return;
    }
    if (ASK_TOOLS.has(input.tool_name ?? "") || (input.tool_name ?? "").startsWith(DESKTOP_TOOL)) return;
    if (READ_TOOLS.has(input.tool_name ?? "")) return;
    if (OUTSIDE_EDITS.has(input.tool_name ?? "") && outside(root, input.cwd!, input.tool_input)) return;
    const command = input.tool_input?.command;
    if (input.tool_name === "Bash" && typeof command === "string" && readOnly(command)) return;
    return "The worker did not finish this step: ask the user first (continue with Claude, retry the worker on another model, or stop) with one question, then do what they pick.";
  }
  if (state.notDone && config.takeover === "sonnet") {
    if (input.tool_name === "Agent" || input.tool_name === "Task") {
      // the hand-off is happening: one per FAIL, so the guard is off once the taker takes over
      writeFileSync(file, JSON.stringify({ ...state, notDone: undefined } satisfies PromptState));
      return;
    }
    if (ASK_TOOLS.has(input.tool_name ?? "") || (input.tool_name ?? "").startsWith(DESKTOP_TOOL)) return;
    if (READ_TOOLS.has(input.tool_name ?? "")) return;
    if (OUTSIDE_EDITS.has(input.tool_name ?? "") && outside(root, input.cwd!, input.tool_input)) return;
    const command = input.tool_input?.command;
    if (input.tool_name === "Bash" && typeof command === "string" && readOnly(command)) return;
    return `The worker did not finish this step: hand it to your Agent tool with model: sonnet (the task, the user's words, the block's found:, test=, error: and worktree) instead of doing it yourself, then report its answer. The user can set takeover: "self" in cheapag.json.`;
  }
  if (state.notDone) {
    const limit = config.limits.takeover_calls;
    if (!limit) return;
    if (state.calls >= limit) return `Take-over budget spent (${limit} tool calls after a cheapag FAIL or PARTIAL): stop now and tell the user what is fixed, what is left and the failing test. The user can raise limits.takeover_calls in cheapag.json.`;
    writeFileSync(file, JSON.stringify({ ...state, calls: state.calls + 1 }));
    return;
  }
  const command = input.tool_input?.command;
  if (state.okPassed && input.tool_name === "Bash" && typeof command === "string" && TEST_CMD.test(command)) {
    return "An OK is done: its checks already passed in the worker's worktree, so don't re-run tests. Report the result, or delegate the next step.";
  }
}

/** Reads Claude Code's PostToolUse JSON for a cheapag tool and records what its result means for this prompt. Never blocks. */
function result(): number {
  try {
    const input: Input = JSON.parse(readFileSync(0, "utf8"));
    if (!input.session_id || !input.prompt_id || input.agent_id || typeof input.cwd !== "string") return 0;
    if (!CHEAPAG_TOOL.test(input.tool_name ?? "")) return 0;
    const out = text(input.tool_response);
    const notDone = didNotFinish(out), okPassed = OK_PASSED.test(out);
    // the worker's own `land applied` finished the block: drop the take-over even when the check never ran
    const cleared = /^OK j\w+ (applied|discarded)\b/m.test(out);
    if (!notDone && !okPassed && !cleared && !/^(?:OK|RUNNING|BUDGET|PROVIDER|BLOCKED|CONFLICT|CANCELLED) j\w+ /m.test(out)) return 0;
    const root = projectRoot(typeof input.tool_input?.root === "string" ? input.tool_input.root : input.cwd);
    const file = stateFile(root, input.session_id!);
    let state: PromptState = { prompt: input.prompt_id, calls: 0 };
    try {
      const saved: PromptState = JSON.parse(readFileSync(file, "utf8"));
      if (saved.prompt === input.prompt_id) state = saved; // a second failure in the same prompt keeps counting from the first
    } catch {
      // first cheapag result of the session
    }
    mkdirSync(join(root, ".cheapag", "hook"), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...state, delegated: true, ...(notDone && { notDone }), ...(okPassed && { okPassed }), ...(cleared && { notDone: undefined }) } satisfies PromptState));
    // shortcut: the marker is never removed, so a repo that once had a cheapag result runs node on every tool call (~50 ms); drop it in `cheapag clean` if that shows
    writeFileSync(marker(root), "");
  } catch {
    // never block
  }
  return 0;
}

/** The text of a tool response: a string, MCP content blocks, or an object holding them. */
function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(text).join("\n");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return typeof o.text === "string" ? o.text : text(o.content ?? "");
  }
  return "";
}

function fileRoot(file: string): string | undefined {
  let dir = dirname(file);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  try { return projectRoot(dir); } catch { return undefined; }
}

function active(input: Input, root: string): boolean {
  if (!input.session_id || !input.prompt_id || input.agent_id) return false;
  try { const s: PromptState = JSON.parse(readFileSync(stateFile(root, input.session_id), "utf8")); return s.prompt === input.prompt_id && s.delegated === true; } catch { return false; }
}

function targetRoots(input: Input): string[] {
  const cwd = input.cwd!;
  const tool = input.tool_input ?? {};
  const paths = typeof tool.file_path === "string" ? [tool.file_path] : input.tool_name === "apply_patch" && typeof tool.command === "string" ? patchEdits(tool.command).map(e => e.path) : [];
  if (input.tool_name === "Bash" && typeof tool.command === "string") for (const re of BASH_WRITES) for (const m of tool.command.matchAll(re)) if (m.groups?.path) paths.push(m.groups.path);
  const roots = paths.length ? paths.map(p => fileRoot(resolve(cwd, p))) : [fileRoot(join(cwd, "_"))];
  return [...new Set(roots.filter((r): r is string => !!r))];
}

function check(input: Input): string | undefined {
  if (process.env.CHEAPAG_ALLOW_EDITS === "1" || !EDIT_TOOLS.has(input.tool_name ?? "")) return;
  const tool = input.tool_input ?? {};
  if (typeof input.cwd !== "string") return;
  if (input.tool_name === "Bash") return typeof tool.command === "string" ? bashCheck(input.cwd, tool.command, input) : undefined;
  if (input.tool_name === "apply_patch") return typeof tool.command === "string" ? patchCheck(input.cwd, tool.command, input) : undefined;
  if (typeof tool.file_path !== "string") return;
  const file = resolve(input.cwd, tool.file_path);
  const root = fileRoot(file);
  if (!root || !active(input, root) || !existsSync(flag(root))) return;
  if (isPlan(root, file)) return; // Claude must be able to write plans of any size
  const limit = loadConfig(root).guard_lines;
  const lines = changed(input.tool_name!, tool, file);
  const state = turnState(input, root);
  const reason = editRules(state?.turn.edits, tool.file_path, file, lines, limit);
  if (reason) return reason;
  if (state) saveTurn(root, state);
}

type Turn = { prompt: string; edits: Record<string, number> };

/**
 * A turn is one user prompt: Claude Code's prompt_id. Without it, prompt-scoped enforcement is disabled and nothing is counted.
 */
function turnState(input: Input, root: string): { turn: Turn; file: string } | undefined {
  if (!input.prompt_id || !input.session_id) return;
  // shortcut: one small file per session, never pruned and not locked against parallel edits; prune in `cheapag clean` if they pile up
  const file = join(root, ".cheapag", "hook", `${input.session_id.replace(/[^\w-]/g, "_")}.json`);
  let turn: Turn = { prompt: input.prompt_id, edits: {} };
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (saved.prompt === input.prompt_id) turn = saved;
  } catch {
    // first edit of the session
  }
  return { turn, file };
}

function saveTurn(root: string, state: { turn: Turn; file: string }) {
  mkdirSync(join(root, ".cheapag", "hook"), { recursive: true });
  writeFileSync(state.file, JSON.stringify(state.turn));
}

/** The size rule, then the 2-edits-per-file-per-turn rule; a pass increments the file's count. */
function editRules(edits: Record<string, number> | undefined, name: string, file: string, lines: number, limit: number): string | undefined {
  if (lines > limit) return `Large edit (${lines} changed lines, over ${limit}): ${REDIRECT}`;
  if (!edits) return;
  if ((edits[file] ?? 0) >= 2) return `3rd edit to ${name} this turn: ${REDIRECT}`;
  edits[file] = (edits[file] ?? 0) + 1;
}

/** A Codex patch file section: `*** Update File:`, `*** Add File:` or `*** Delete File:`; other `***` lines end it. */
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;

/** Codex's apply_patch text as one entry per file with the lines its hunks add and remove. Unknown text yields none. */
function patchEdits(patch: string): { path: string; lines: number }[] {
  const edits: { path: string; lines: number }[] = [];
  let current: { path: string; lines: number } | undefined;
  for (const line of patch.split("\n")) {
    const file = PATCH_FILE.exec(line);
    if (file) {
      current = { path: file[1].trim(), lines: 0 };
      edits.push(current);
    } else if (line.startsWith("*** Move to:") && current) {
      edits.push({ path: line.slice("*** Move to:".length).trim(), lines: current.lines });
    } else if (line.startsWith("*** ")) {
      current = undefined;
    } else if (current && (line.startsWith("+") || line.startsWith("-"))) {
      current.lines++;
    }
  }
  return edits;
}

/** Each file in a Codex patch goes through the Edit/Write rules; a malformed patch yields no files and is allowed. */
function patchCheck(cwd: string, patch: string, input: Input): string | undefined {
  const states = new Map<string, NonNullable<ReturnType<typeof turnState>>>();
  for (const edit of patchEdits(patch)) {
    const file = resolve(cwd, edit.path);
    const root = fileRoot(file);
    if (!root || !active(input, root) || !existsSync(flag(root)) || isPlan(root, file)) continue;
    const state = states.get(root) ?? turnState(input, root)!;
    states.set(root, state);
    const reason = editRules(state.turn.edits, edit.path, file, edit.lines, loadConfig(root).guard_lines);
    if (reason) return reason;
  }
  for (const [root, state] of states) saveTurn(root, state);
}

/** Plans live in .plan/ and are how Claude delegates, so the guard never blocks them. */
const isPlan = (root: string, file: string) => file.startsWith(join(root, ".plan") + sep);

/** Sonnet take-over: Bash is read-only when no part writes or runs tests, and every `&&`/`;`/`|` part starts with a reader. */
function readOnly(command: string): boolean {
  if (command.includes(">")) return false;
  if (TEST_CMD.test(command) || BASH_INPLACE.test(command) || BASH_CODE_WRITES.test(command)) return false;
  if (BASH_WRITES.some((re) => command.match(re))) return false;
  const parts = command.split(/&&|\|\||;|\|/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(readPart);
}

/**
 * One `&&`/`;`/`|` part is a read when a reader still starts it once env prefixes and `cd` are dropped:
 * `X=1 git log` and `cd /repo` change no file, and `git -C <dir> diff` reads like `git diff`.
 */
function readPart(part: string): boolean {
  const p = stripGitOptions(part.replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, "")).trim();
  if (p === "cd" || p.startsWith("cd ") || p.startsWith("export ")) return true;
  return READ_PARTS.some((r) => p === r || p.startsWith(r + " "));
}

/** Drops git's directory/pager options (`-C <dir>`, `--no-pager`, `-c k=v`) so the verb starts the part. */
const stripGitOptions = (part: string) => part.replace(/^git\s+(?:(?:-C\s+\S+|--no-pager|-c\s+\S+)\s+)+/, "git ");

/** The first line says the worker did not finish, unless an env-kind FAIL could not run its check at all: nothing to take over. */
function didNotFinish(out: string): boolean {
  return out.split("\n").some((line) => NOT_DONE.test(line) && !(line.startsWith("FAIL ") && /\bcheck=env\b/.test(line)));
}

/** An edit path resolves outside the repo, so it cannot touch the worker's worktree. */
function outside(root: string, cwd: string, tool: Record<string, unknown> | undefined): boolean {
  const p = tool?.file_path ?? tool?.notebook_path;
  if (typeof p !== "string") return false;
  const abs = resolve(cwd, p);
  return abs !== root && !abs.startsWith(root + sep);
}

/** A Bash command is denied when it writes a file inside the repo (any size: the lines can't be counted), unless the file is a plan. */
function bashCheck(cwd: string, command: string, input: Input): string | undefined {
  const root = fileRoot(join(cwd, "_"));
  const targets: string[] = [];
  for (const re of BASH_WRITES) for (const m of command.matchAll(re)) if (m.groups?.path) targets.push(m.groups.path);
  const inRepo = (p: string) => { const abs = resolve(cwd, p); const r = fileRoot(abs); return !!r && active(input, r) && existsSync(flag(r)) && !isPlan(r, abs); };
  const written = targets.filter((p) => p !== "/dev/null" && inRepo(p));
  if (written.length) return `Bash writing ${written[0]}: ${REDIRECT}`;
  if (!root || !active(input, root) || !existsSync(flag(root))) return;
  if (BASH_INPLACE.test(command)) return `Bash in-place edit (sed/perl -i): ${REDIRECT}`;
  if (BASH_CODE_WRITES.test(command)) return `Bash running code that writes files: ${REDIRECT}`;
}

/** Changed lines of an edit: the larger side once the lines both sides share at the start and end are dropped. */
function changed(name: string, tool: Record<string, unknown>, file: string) {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  // shortcut: replace_all counts one occurrence; count matches in the file if guarded edits slip through that way
  if (name === "Edit") return diff(text(tool.old_string), text(tool.new_string));
  if (name === "MultiEdit") return (Array.isArray(tool.edits) ? tool.edits : []).reduce((n: number, e) => n + diff(text(e?.old_string), text(e?.new_string)), 0);
  return diff(existsSync(file) ? readFileSync(file, "utf8") : "", text(tool.content));
}

function diff(before: string, after: string) {
  const a = before.split("\n"), b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return Math.max(a.length - start - end, b.length - start - end);
}
