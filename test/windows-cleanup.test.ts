import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cleanup } from "../src/cleanup.js";
import { createWorktree, git, removeWorktree } from "../src/workspace.js";
import { tempRepo } from "./harness.js";

// A child cwd is a real Windows directory handle. Node's rmSync maxRetries does not
// retry the native EPERM on this path; both finalization and later cleanup must cope.
test.skipIf(process.platform !== "win32").each(["finalize", "retention"])("%s retries a transient directory handle", async (mode) => {
  const repo = tempRepo();
  const tree = createWorktree(repo.dir, "jlock", []);
  const child = spawn(process.execPath, ["-e", "console.log('ready'); setTimeout(() => {}, 1500)"], {
    cwd: tree.path, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => { child.stdout!.once("data", () => resolve()); child.once("error", reject); });
    if (mode === "finalize") removeWorktree(repo.dir, tree);
    else {
      // No job record: an old/orphaned worktree is eligible under --all.
      mkdirSync(join(repo.dir, ".cheapag/jobs"), { recursive: true });
      const result = cleanup(repo.dir, { unlanded_worktree_days: 2, job_log_days: 7 }, [], { all: true, now: Date.now() + 86400000 });
      expect(result.removed).toContain("worktree jlock: --all");
    }
    expect(existsSync(tree.path)).toBe(false);
    expect(git(repo.dir, ["worktree", "list", "--porcelain"])).not.toContain("jlock");
  } finally {
    child.kill();
    await exited;
    repo.cleanup();
  }
});
