import { expect, test } from "vitest";
import { repositoryError } from "../src/repository-errors.js";
test("repository failures retain distinct actionable categories without dumping stderr", () => {
  for (const [error, code] of [[{ code: "ENOENT" }, "missing-git"], [{ stderr: "fatal: not a git repository" }, "not-repository"], [{ stderr: "dubious ownership" }, "ownership"], [{ code: "EACCES" }, "access"], [{ stderr: "failure https://secret@host" }, "git-failure"]] as const) {
    const result = repositoryError("/repo", error);
    expect(result.code).toBe(code); expect(result.message).not.toContain("secret");
  }
});
