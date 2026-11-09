import { redact } from "./credentials.js";

export type RepositoryErrorCode = "not-repository" | "missing-git" | "access" | "ownership" | "git-failure";
export class RepositoryError extends Error {
  constructor(public code: RepositoryErrorCode, message: string) { super(redact(message)); this.name = "RepositoryError"; }
}

export function repositoryError(cwd: string, error: unknown): RepositoryError {
  const e = error as { code?: string; stderr?: Buffer | string };
  const detail = String(e.stderr ?? "");
  const code: RepositoryErrorCode = e.code === "ENOENT" ? "missing-git"
    : /dubious ownership|safe.directory/i.test(detail) ? "ownership"
    : /not a git repository/i.test(detail) ? "not-repository"
    : e.code === "EACCES" || /permission denied|access denied/i.test(detail) ? "access" : "git-failure";
  const reason = { "not-repository": "is not inside a git repository; specify --repo <path>", "missing-git": "cannot run Git (missing executable or working directory)", access: "Git access denied", ownership: "Git rejected repository ownership; review safe.directory", "git-failure": "Git repository lookup failed" }[code];
  // Raw Git stderr may include remote URLs or credentials. Preserve the actionable category only.
  return new RepositoryError(code, `${cwd}: ${reason}`);
}
