import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { allowCodex, consentGate, describe, writeConsent, type Consent } from "./consent.js";
import { detectProvider, LOGIN_COMMAND, providerLabel, redact } from "./credentials.js";
import { modelName, routeModels } from "./routing.js";
import { git, projectRoot } from "./workspace.js";

const USAGE = "usage: cheapag allow [--zdr-only | --models <provider/model,…> | --codex]";

/**
 * `cheapag allow`: the developer's opt-in for the current repo (spec: Consent). Non-interactive, so the plugin's
 * user-only `/cheapag:allow` can wrap it. No MCP tool calls this. Modes: all models (no flag), zero-retention only,
 * or an explicit model list. The consent is for the provider logged in now; a later switch asks again.
 */
export function allow(args: string[]): number {
  const out = (line: string) => process.stdout.write(redact(line) + "\n");
  // Codex is its own recipient (OpenAI): its opt-in is separate, and needs no OpenCode login (docs/codex-worker.md)
  if (args.length === 1 && args[0] === "--codex") return allowCodexHere(out);
  let consent: Omit<Consent, "provider" | "approvedAt">;
  if (!args.length) consent = { mode: "all" };
  else if (args.length === 1 && args[0] === "--zdr-only") consent = { mode: "zdr-only" };
  else if (args.length === 2 && args[0] === "--models" && args[1].split(",").some((m) => m.trim())) {
    consent = { mode: "models", models: args[1].split(",").map((m) => m.trim()).filter(Boolean) };
  } else {
    out(`✗ ${USAGE}`);
    return 1;
  }
  const provider = detectProvider();
  if (!provider) {
    out(`✗ no worker provider; run ${LOGIN_COMMAND} first`);
    return 1;
  }
  let root: string;
  try {
    root = projectRoot(process.cwd());
  } catch (err) {
    out(`✗ ${(err as Error).message}`);
    return 1;
  }
  const record: Consent = { ...consent, provider: provider.provider, approvedAt: new Date().toISOString() };
  writeConsent(root, record);
  out(`✓ ${root}: code may go to ${providerLabel(provider.provider)} (${describe(record)})`);
  out("  scope: this Git repository and all its linked worktrees");
  // the same gate delegate uses, so what this prints is what jobs will run
  const gate = consentGate(root, provider.provider);
  if ("block" in gate) out(`! ${gate.block}`);
  else out(`  models: ${routeModels(gate.route).map(modelName).join(", ")}`);
  excludeState(root, out);
  return 0;
}

/** `cheapag allow --codex`: code from this repo may go to OpenAI through the Codex CLI, for delegate's codex/ models. */
function allowCodexHere(out: (line: string) => void): number {
  let root: string;
  try {
    root = projectRoot(process.cwd());
  } catch (err) {
    out(`✗ ${(err as Error).message}`);
    return 1;
  }
  allowCodex(root);
  out(`✓ ${root}: code may go to OpenAI through the Codex CLI (delegate with model codex/<model> or codex/default)`);
  out("  scope: this Git repository and all its linked worktrees");
  excludeState(root, out);
  return 0;
}

/** .cheapag/ state is local: keep it out of `git status` without touching the repo's tracked .gitignore. */
function excludeState(root: string, out: (line: string) => void) {
  if (spawnSync("git", ["check-ignore", "-q", ".cheapag/"], { cwd: root, stdio: "pipe" }).status !== 0) {
    const exclude = resolve(root, git(root, ["rev-parse", "--git-path", "info/exclude"]).trim());
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, "\n.cheapag/\n");
    out("✓ .cheapag/ added to .git/info/exclude (local, never committed)");
  }
}
