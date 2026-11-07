import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { startFakeOpencode } from "./fake-opencode.js";
import { allowRepo, callText, homeEnv, removeDir, slow, startServer, tempRepo } from "./harness.js";
import { isAlive } from "../src/platform.js";

/** Codex engine (docs/codex-worker.md): delegate with a codex/ model runs the fake `codex exec` in test/fake-codex.mjs. */

const FAKE = join(import.meta.dirname, "fake-codex.mjs");
type Action = Record<string, unknown>;
type Run = { pid: number; argv: string[]; cwd: string; prompt: string };

const REPORT = { summary: "added hello", risks: ["none known"], review: ["src/hello.ts:1-1"], missing: [] };

/**
 * A repo, a fake Codex scripted with one action list per run, and a server whose OpenCode is a fake that must stay
 * untouched. `codex`: give the Codex opt-in. `config`: the repo's cheapag.json.
 */
async function scenario(runs: Action[][], opts: { codex?: boolean; allow?: string[]; config?: object; bin?: string } = {}) {
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  if (opts.config) {
    writeFileSync(join(repo.dir, "cheapag.json"), JSON.stringify(opts.config));
    repo.git("add", "cheapag.json");
    repo.git("commit", "-q", "-m", "config");
  }
  const state = mkdtempSync(join(tmpdir(), "cheapag-codex-"));
  onTestFinished(() => removeDir(state));
  writeFileSync(join(state, "script.json"), JSON.stringify(runs));
  // the user's Codex config, which codex/default and the Windows sandbox read (never the developer's own)
  writeFileSync(join(state, "config.toml"), 'model = "gpt-user"\nmodel_reasoning_effort = "high"\n\n[mcp_servers.x]\ncommand = "x"\n\n[windows]\nsandbox = "elevated"\n');
  const opencode = await startFakeOpencode();
  onTestFinished(opencode.close);
  const env = { CHEAPAG_OPENCODE_URL: opencode.url, CHEAPAG_CODEX_BIN: opts.bin ?? FAKE, CHEAPAG_FAKE_CODEX: state, CODEX_HOME: state };
  const server = await startServer({ cwd: repo.dir, env, logins: { "opencode-go": "go-key" }, ...(opts.allow && { allow: opts.allow }) });
  onTestFinished(server.close);
  const cliEnv = { ...homeEnv(server.home), ...env };
  if (opts.codex) allowRepo(repo.dir, cliEnv, ["--codex"]);
  const runs_ = (): Run[] => (existsSync(join(state, "log.jsonl")) ? readFileSync(join(state, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const delegate = (args: Record<string, unknown>) => callText(server.client, "delegate", { model: "codex/gpt-test", ...args });
  return { repo, opencode, server, delegate, runs: runs_, cliEnv };
}

test("a codex/ model runs codex exec in the worktree, lands OK, and never boots OpenCode", async () => {
  const { repo, opencode, delegate, runs } = await scenario([[{ cmd: "ls" }, { write: "src/hello.ts", content: "export const hello = 1;\n" }, { report: REPORT }]], { codex: true });
  const text = await delegate({ task: "Add src/hello.ts exporting hello = 1", files: "src/hello.ts" });
  expect(text).toMatch(/^OK j[0-9a-z]{4} step=1 /);
  expect(text).toContain("added hello");
  expect(readFileSync(join(repo.dir, "src", "hello.ts"), "utf8")).toBe("export const hello = 1;\n");
  const [run] = runs();
  expect(run.argv.slice(0, 2)).toEqual(["exec", "--json"]);
  expect(run.argv).toEqual(expect.arrayContaining(["--ignore-user-config", "--disable", "hooks", "-s", "workspace-write", "-m", "gpt-test", "-"]));
  // the worktree, not the repo
  const at = run.argv[run.argv.indexOf("-C") + 1];
  expect(at).not.toBe(repo.dir);
  expect(at).toContain(join(".cheapag", "worktrees"));
  expect(run.prompt).toContain("```cheapag-result");
  expect(run.prompt).toContain("Add src/hello.ts exporting hello = 1");
  // nothing reached OpenCode: no boot, no session
  expect(opencode.recorded.requests).toEqual([]);
  const job = text.match(/^OK (j[0-9a-z]{4})/)![1];
  const record = JSON.parse(readFileSync(join(repo.dir, ".cheapag", "jobs", job, "result.json"), "utf8"));
  expect(record.models.requested).toBe("codex/gpt-test");
  expect(record.sessionID).toBe("thread-1");
  expect(record.usage).toMatchObject({ turns: 2, costUsd: 0, inputTokens: 600, cacheRead: 400 });
});

test("codex/default runs the user's configured model and effort; on Windows it keeps their sandbox mode", async () => {
  const s = await scenario([[{ write: "a.txt", content: "a\n" }, { report: REPORT }]], { codex: true });
  expect(await s.delegate({ task: "Add a.txt", model: "codex/default" })).toMatch(/^OK /);
  const { argv } = s.runs()[0];
  expect(argv).toEqual(expect.arrayContaining(["-m", "gpt-user", "-c", 'model_reasoning_effort="high"']));
  // without it, workspace-write runs read-only on Windows once the user config is ignored (seen live)
  if (process.platform === "win32") expect(argv).toEqual(expect.arrayContaining(["-c", 'windows.sandbox="elevated"']));
  else expect(argv.join(" ")).not.toContain("windows.sandbox");
});

test("a codex/ model needs its own consent: CONSENT without allow --codex, even with the provider allowed; then it runs", async () => {
  const s = await scenario([[{ write: "a.txt", content: "a\n" }, { report: REPORT }]], { allow: [] });
  const refused = await s.delegate({ task: "Add a.txt" });
  expect(refused).toMatch(/^CONSENT repo=/);
  expect(refused).toContain("OpenAI via the Codex CLI");
  expect(refused).toContain("allow --codex");
  expect(s.runs()).toEqual([]);
  allowRepo(s.repo.dir, s.cliEnv, ["--codex"]);
  // a later plain allow keeps the Codex opt-in
  allowRepo(s.repo.dir, s.cliEnv, []);
  const consent = JSON.parse(readFileSync(join(s.repo.dir, ".cheapag", "consent.json"), "utf8"));
  expect(consent.mode).toBe("all");
  expect(consent.engines.codex.approvedAt).toMatch(/^\d{4}-/);
  expect(await s.delegate({ task: "Add a.txt" })).toMatch(/^OK /);
  expect(await callText(s.server.client, "ping")).toContain(" codex=allowed");
});

test("allow --codex alone gives no OpenCode consent: the configured route still asks", async () => {
  const s = await scenario([], { codex: true });
  expect(await callText(s.server.client, "delegate", { task: "Add a.txt" })).toMatch(/^CONSENT repo=/);
  expect(await callText(s.server.client, "research", { question: "where?", model: "codex/x" })).toMatch(/^CONSENT repo=/);
  allowRepo(s.repo.dir, s.cliEnv, []);
  expect(await callText(s.server.client, "research", { question: "where?", model: "codex/x" })).toBe(
    "FAIL reason: model codex/x: Codex models run delegate jobs only; research runs on the configured OpenCode Go route");
});

test("a failing done-when check resumes the same Codex thread with the error, then lands OK", async () => {
  const check = "node -e \"process.exit(require('fs').readFileSync('v.txt','utf8').trim()==='2'?0:1)\"";
  const s = await scenario([
    [{ write: "v.txt", content: "1\n" }, { report: REPORT }],
    [{ write: "v.txt", content: "2\n" }, { report: { ...REPORT, summary: "fixed v" } }],
  ], { codex: true });
  const text = await s.delegate({ task: "Write 2 to v.txt", done_when: `\`${check}\`` });
  expect(text).toMatch(/^OK /);
  expect(readFileSync(join(s.repo.dir, "v.txt"), "utf8")).toBe("2\n");
  const [first, fix] = s.runs();
  expect(first.argv[1]).not.toBe("resume");
  expect(fix.argv.slice(0, 3)).toEqual(["exec", "resume", "thread-1"]);
  expect(fix.argv).toEqual(expect.arrayContaining(["-c", 'sandbox_mode="workspace-write"', "-m", "gpt-test"]));
  expect(fix.cwd).toBe(first.argv[first.argv.indexOf("-C") + 1]);
  expect(fix.prompt).toMatch(/^Verification failed/);
  expect(fix.prompt).toContain("no finish tool");
});

test("the turn cap kills the codex process and the job stops", async () => {
  const s = await scenario([[{ tools: 3 }, { sleep: 120_000 }], [{ text: "found nothing" }]], { codex: true, config: { limits: { max_turns: 2 } } });
  const started = Date.now();
  const text = await s.delegate({ task: "Look around" });
  expect(text).toMatch(/^FAIL /);
  expect(text).toContain("turn cap (2) reached");
  expect(Date.now() - started).toBeLessThan(slow(30_000));
  expect(isAlive(s.runs()[0].pid)).toBe(false);
});

test("the minute cap kills the codex process: TIMEOUT", async () => {
  const s = await scenario([[{ sleep: 120_000 }], [{ text: "nothing yet" }]], { codex: true, config: { limits: { max_minutes: 0.03 } } });
  const text = await s.delegate({ task: "Take forever" });
  expect(text).toMatch(/^TIMEOUT /);
  expect(isAlive(s.runs()[0].pid)).toBe(false);
});

test("cancelling a running Codex job kills its process", async () => {
  const s = await scenario([[{ cmd: "ls" }, { sleep: 120_000 }]], { codex: true });
  const running = await s.delegate({ task: "Take forever", wait: false });
  const job = running.match(/^RUNNING (j[0-9a-z]{4})/)![1];
  await expect.poll(() => s.runs().length, { timeout: slow(10_000) }).toBe(1);
  await callText(s.server.client, "jobs", { action: "cancel", job });
  expect(await callText(s.server.client, "jobs", { action: "wait", job })).toMatch(/^CANCELLED /);
  await expect.poll(() => isAlive(s.runs()[0].pid), { timeout: slow(5_000) }).toBe(false);
});

test("a missing Codex binary or a crashed run FAILs with the reason", async () => {
  const missing = await scenario([], { codex: true, bin: join(tmpdir(), "no-such-codex.mjs") });
  const text = await missing.delegate({ task: "Add a.txt" });
  expect(text).toMatch(/^FAIL /);
  expect(text).toContain("Codex CLI not found");
  const crashed = await scenario([[{ exit: 3, stderr: "boom: not signed in" }]], { codex: true });
  const crash = await crashed.delegate({ task: "Add a.txt" });
  expect(crash).toMatch(/^FAIL /);
  expect(crash).toContain("codex exited with code 3: boom: not signed in");
});

test("a Codex usage limit stops the job as BUDGET in Codex's words", async () => {
  const s = await scenario([[{ fail: "You've hit your usage limit. Try again at 5:00 PM." }]], { codex: true });
  const text = await s.delegate({ task: "Add a.txt" });
  expect(text).toMatch(/^BUDGET /);
  expect(text).toContain("Codex usage limit for gpt-test: You've hit your usage limit");
});
