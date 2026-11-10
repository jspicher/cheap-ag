import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "./workspace.js";

/** Git's repository identity is shared by linked worktrees, unlike --show-toplevel. */
export function consentFile(root: string): string {
  const common = resolve(root, git(root, ["rev-parse", "--git-common-dir"]).trim());
  return join(common, "cheapag", "consent.json");
}

/**
 * Shared consent wins, including an empty or damaged record (never resurrect stale approval).
 * Until the developer writes shared consent, inherit the primary checkout's legacy record.
 * A legacy slot-only record remains local; reading it never grants consent to sibling worktrees.
 */
export function readConsentRecord(root: string): Record<string, unknown> | undefined {
  try {
    let file = consentFile(root);
    if (!existsSync(file)) {
      const first = git(root, ["worktree", "list", "--porcelain", "-z"]).split("\0")[0];
      const primary = first.startsWith("worktree ") ? first.slice(9) : root;
      const legacy = join(primary, ".cheapag", "consent.json");
      file = existsSync(legacy) ? legacy : join(root, ".cheapag", "consent.json");
    }
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
