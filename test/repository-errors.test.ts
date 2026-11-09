import { expect, onTestFinished, test } from "vitest";
import { rmSync } from "node:fs";
import { relative } from "node:path";
import { hermeticHome, tempRepo } from "./harness.js";
import { repoArgs } from "../src/cli-repo.js";
import { repositoryError } from "../src/repository-errors.js";
test("repository failures retain distinct actionable categories without dumping stderr", () => {
  for (const [error, code] of [[{ code: "ENOENT" }, "missing-git"], [{ stderr: "fatal: not a git repository" }, "not-repository"], [{ stderr: "dubious ownership" }, "ownership"], [{ code: "EACCES" }, "access"], [{ stderr: "failure https://secret@host" }, "git-failure"]] as const) {
    const result = repositoryError("/repo", error);
    expect(result.code).toBe(code); expect(result.message).not.toContain("secret");
  }
});
test("CLI targets are explicit outside a repository and relative to the invocation directory", () => {
  const repo = tempRepo(); onTestFinished(repo.cleanup);
  const { home } = hermeticHome(); onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  expect(() => repoArgs([], home)).toThrow(/specify --repo/);
  expect(repoArgs(["--all", "--repo", relative(home, repo.dir)], home)).toEqual({ args: ["--all"], root: repo.dir });
  expect(() => repoArgs(["--repo"], home)).toThrow(/requires a path/);
  expect(() => repoArgs(["--repo", repo.dir, "--repo", repo.dir], home)).toThrow(/only once/);
});
