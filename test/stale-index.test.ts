import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { tempRepo } from "./harness.js";
import { createWorktree, worktreeDiff, land, removeWorktree } from "../src/workspace.js";

test("landing preserves concurrent assume-unchanged content and the real index", async () => {
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  const tree = createWorktree(repo.dir, "jstale", []);
  onTestFinished(() => removeWorktree(repo.dir, tree));
  writeFileSync(join(tree.path, "README.md"), "# worker!\n");
  const { patch } = worktreeDiff(tree);
  repo.git("update-index", "--assume-unchanged", "README.md");
  const index = readFileSync(join(repo.dir, ".git", "index"));
  const stash = repo.git("stash", "list");
  writeFileSync(join(repo.dir, "README.md"), "# user's!\n");
  mkdirSync(join(repo.dir, ".cheapag/jobs/jstale"), { recursive: true });
  expect(await land(repo.dir, "jstale", patch, ["README.md"])).toBeTruthy();
  expect(readFileSync(join(repo.dir, "README.md"), "utf8")).toBe("# user's!\n");
  expect(readFileSync(join(repo.dir, ".git", "index"))).toEqual(index);
  expect(repo.git("stash", "list")).toBe(stash);
});

test.each(["assume-unchanged", "stale-stat"])("landing merges disjoint developer edits despite %s", async mode => {
  const repo = tempRepo(); onTestFinished(repo.cleanup);
  const file = join(repo.dir, "README.md");
  const base = "one\ntwo\nthree\nfour\nfive\nsix\n";
  const old = new Date("2000-01-01T00:00:00Z");
  repo.git("config", "core.trustctime", "false"); repo.git("config", "core.checkStat", "minimal");
  writeFileSync(file, base); utimesSync(file, old, old); repo.git("add", "README.md"); repo.git("commit", "-m", "fixture");
  const tree = createWorktree(repo.dir, "jmerge", []); onTestFinished(() => removeWorktree(repo.dir, tree));
  writeFileSync(join(tree.path, "README.md"), base.replace("one", "ONE"));
  const { patch } = worktreeDiff(tree);
  if (mode === "assume-unchanged") repo.git("update-index", "--assume-unchanged", "README.md");
  const index = readFileSync(join(repo.dir, ".git/index"));
  writeFileSync(file, base.replace("six", "SIX"));
  if (mode === "stale-stat") utimesSync(file, old, old);
  mkdirSync(join(repo.dir, ".cheapag/jobs/jmerge"), { recursive: true });
  expect(await land(repo.dir, "jmerge", patch, ["README.md"])).toBeUndefined();
  expect(readFileSync(file, "utf8")).toBe(base.replace("one", "ONE").replace("six", "SIX"));
  expect(readFileSync(join(repo.dir, ".git/index"))).toEqual(index);
});

test("rehashing supports additions, deletions, renames and line-ending normalization", async () => {
  const repo = tempRepo(); onTestFinished(repo.cleanup);
  for (const name of ["delete.txt", "rename.txt", "normalize.txt"]) writeFileSync(join(repo.dir, name), "old\n");
  writeFileSync(join(repo.dir, ".gitattributes"), "*.txt text eol=lf\n");
  repo.git("add", "."); repo.git("commit", "-m", "files");
  const tree = createWorktree(repo.dir, "jfiles", []); onTestFinished(() => removeWorktree(repo.dir, tree));
  rmSync(join(tree.path, "delete.txt")); renameSync(join(tree.path, "rename.txt"), join(tree.path, "renamed.txt"));
  writeFileSync(join(tree.path, "added.txt"), "added\r\n"); writeFileSync(join(tree.path, "normalize.txt"), "new\r\n");
  const { patch, changed } = worktreeDiff(tree);
  const index = readFileSync(join(repo.dir, ".git/index"));
  mkdirSync(join(repo.dir, ".cheapag/jobs/jfiles"), { recursive: true });
  expect(await land(repo.dir, "jfiles", patch, changed.map(c => c.path))).toBeUndefined();
  expect(existsSync(join(repo.dir, "delete.txt"))).toBe(false); expect(existsSync(join(repo.dir, "rename.txt"))).toBe(false);
  expect(readFileSync(join(repo.dir, "renamed.txt"), "utf8")).toBe("old\n");
  expect(readFileSync(join(repo.dir, "added.txt"), "utf8")).toBe("added\n");
  expect(readFileSync(join(repo.dir, "normalize.txt"), "utf8")).toBe("new\n");
  expect(readFileSync(join(repo.dir, ".git/index"))).toEqual(index);
});
