import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { allowRepo, callText, homeEnv, slow, startServer, tempRepo } from "./harness.js";

// Explicit opt-in: real bundled OpenCode and paid OpenRouter; only synthetic fixture code leaves this repo.
test.skipIf(!process.env.CHEAPAG_LIVE || !process.env.OPENROUTER_API_KEY)(
  "live shared approval: a running MCP server delegates in existing and future worktrees, then rejects new recipients",
  async () => {
    const repo = tempRepo(); onTestFinished(repo.cleanup);
    writeFileSync(join(repo.dir, "cheapag.json"), JSON.stringify({
      models: { implement: "openrouter/deepseek/deepseek-v4.1-flash", research: "openrouter/deepseek/deepseek-v4.1-flash", fallback: [] },
      limits: { max_turns: 10, max_minutes: 3, max_cost_usd: 0.25 },
    }));
    writeFileSync(join(repo.dir, "verify-smoke.cjs"), "const fs = require('node:fs'); if (fs.readFileSync('hello.txt', 'utf8').trim() !== 'hello from cheapag') process.exit(1);\n");
    repo.git("add", "cheapag.json", "verify-smoke.cjs"); repo.git("commit", "-m", "bounded smoke configuration");
    const first = join(repo.dir, ".cheapag", "existing");
    repo.git("worktree", "add", "--detach", first, "HEAD");
    const server = await startServer({ cwd: repo.dir, logins: { openrouter: process.env.OPENROUTER_API_KEY! } });
    onTestFinished(server.close);
    expect(await callText(server.client, "ping", { root: first })).toContain("consent=required");
    allowRepo(repo.dir, homeEnv(server.home));
    const later = join(repo.dir, ".cheapag", "future");
    repo.git("worktree", "add", "--detach", later, "HEAD");
    for (const root of [first, later]) {
      expect(existsSync(join(root, ".cheapag", "consent.json"))).toBe(false);
      expect(await callText(server.client, "ping", { root })).toContain("consent=allowed");
      const result = await server.client.callTool({
        name: "delegate",
        arguments: {
          root, kind: "change", files: "hello.txt",
          task: "Create hello.txt containing exactly the following line (no period):\n```text\nhello from cheapag\n```\nDo not modify other files.",
          done_when: "`node verify-smoke.cjs` succeeds",
        },
      }, undefined, { timeout: 240_000 });
      const text = (result.content as { text: string }[]).map((c) => c.text).join("\n");
      expect(text).toMatch(/^OK /);
      expect(text).toContain("tests=pass");
      expect(readFileSync(join(root, "hello.txt"), "utf8").trim()).toBe("hello from cheapag");
      const job = text.split(" ")[1];
      const record = JSON.parse(readFileSync(join(root, ".cheapag", "jobs", job, "result.json"), "utf8"));
      expect(record.landed).toBe(true);
      console.log(JSON.stringify({ checkout: root === first ? "existing" : "future", job, status: record.status, landed: record.landed, usage: record.usage }));
    }
    expect(existsSync(join(repo.dir, "hello.txt"))).toBe(false);
    expect(existsSync(join(repo.dir, ".cheapag", "jobs"))).toBe(false);
    const unrelated = tempRepo(); onTestFinished(unrelated.cleanup);
    expect(await callText(server.client, "delegate", { root: unrelated.dir, task: "Write hello.txt" })).toMatch(/^CONSENT /);
    writeFileSync(join(later, "cheapag.json"), JSON.stringify({ models: { implement: "openrouter/new/unapproved" } }));
    expect(await callText(server.client, "ping", { root: later })).toContain("consent=required");
    expect(await callText(server.client, "delegate", { root: later, task: "Write other.txt" })).toMatch(/^CONSENT /);
    expect(existsSync(join(later, "other.txt"))).toBe(false);
  }, slow(240_000),
);
