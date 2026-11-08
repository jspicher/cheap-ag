import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import { hermeticHome, removeDir, tempRepo } from "./harness.js";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<any>>() }));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name: string, _schema: unknown, handler: (...args: any[]) => Promise<any>) { handlers.set(name, handler); }
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
import { serve } from "../src/server.js";

test("each prepared root gets one hourly cleanup; expired logs go and active jobs survive", async () => {
  const here = tempRepo(), there = tempRepo();
  const { home, env } = hermeticHome({});
  for (const [key, value] of Object.entries(env)) if (key.startsWith("XDG_")) vi.stubEnv(key, value);
  const oldCwd = process.cwd();
  process.chdir(here.dir);
  const events = ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const;
  const before = new Map(events.map((event) => [event, process.listeners(event)]));
  const stdinBefore = process.stdin.listeners("end");
  onTestFinished(() => {
    for (const event of events) for (const listener of process.listeners(event)) {
      if (!before.get(event)!.includes(listener)) process.removeListener(event, listener as (...args: any[]) => void);
    }
    for (const listener of process.stdin.listeners("end")) if (!stdinBefore.includes(listener)) process.stdin.removeListener("end", listener as () => void);
    process.chdir(oldCwd);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    handlers.clear();
    here.cleanup();
    there.cleanup();
    removeDir(home);
  });
  vi.useFakeTimers();
  await serve();
  const extra = { sendNotification: async () => {} };
  await handlers.get("delegate")!({ task: "Add a.txt", root: there.dir }, extra);
  await handlers.get("delegate")!({ task: "Add a.txt", root: there.dir }, extra);
  expect(vi.getTimerCount()).toBe(2);
  for (const repo of [here, there]) {
    for (const [id, status] of [["jold1", "OK"], ["jrun1", "RUNNING"]]) {
      const dir = join(repo.dir, ".cheapag", "jobs", id);
      mkdirSync(dir, { recursive: true });
      const at = new Date(Date.now() - 60 * 86_400_000).toISOString();
      writeFileSync(join(dir, "result.json"), JSON.stringify({ status, pid: process.pid, timing: { startedAt: at, endedAt: status === "OK" ? at : null } }));
    }
    mkdirSync(join(repo.dir, ".cheapag", "worktrees", "jrun1"), { recursive: true });
    writeFileSync(join(repo.dir, ".cheapag", "worktrees", "jrun1", "fix.txt"), "active fix");
  }
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  for (const repo of [here, there]) {
    expect(existsSync(join(repo.dir, ".cheapag", "jobs", "jold1"))).toBe(false);
    expect(existsSync(join(repo.dir, ".cheapag", "jobs", "jrun1"))).toBe(true);
    expect(readFileSync(join(repo.dir, ".cheapag", "worktrees", "jrun1", "fix.txt"), "utf8")).toBe("active fix");
  }
});
