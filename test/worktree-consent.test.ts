import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import { consentFile } from "../src/consent-storage.js";
import { writePlugin } from "../src/install.js";
import { codexGate, consentGate, readConsent, readEngines, routeMoved, writeConsent } from "../src/consent.js";
import { allowRepo, callText, hermeticHome, homeEnv, removeDir, startServer, tempRepo } from "./harness.js";
import { startFakeOpencode } from "./fake-opencode.js";

function fixture() {
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  const home = hermeticHome({ openrouter: "test-key" });
  onTestFinished(() => removeDir(home.home));
  vi.stubEnv("XDG_CONFIG_HOME", home.env.XDG_CONFIG_HOME);
  onTestFinished(() => { vi.unstubAllEnvs(); });
  const slot = join(repo.dir, ".cheapag", "slot");
  repo.git("worktree", "add", "--detach", slot, "HEAD");
  return { repo, home, slot };
}

test("provider-wide consent is shared, stays provider-bound, and can be narrowed without losing Codex approval", () => {
  const { repo, home, slot } = fixture();
  expect(allowRepo(slot, home.env, ["--provider-wide"])).toContain("current and future OpenRouter models");
  expect(readConsent(repo.dir)?.scope).toBe("provider");
  const approved = readFileSync(consentFile(repo.dir), "utf8");
  writePlugin(join(home.home, "runtime", "index.js"), process.execPath);
  expect(readFileSync(consentFile(repo.dir), "utf8")).toBe(approved);
  writeFileSync(join(slot, "cheapag.json"), JSON.stringify({ models: { implement: "openrouter/future/model" } }));
  expect(consentGate(slot, "openrouter")).toHaveProperty("route");
  expect(consentGate(slot, "deepseek")).toHaveProperty("block");
  expect(codexGate(slot, { providerID: "codex", id: "default" })).toHaveProperty("block");
  allowRepo(slot, home.env, ["--codex"]);
  expect(readConsent(repo.dir)?.scope).toBe("provider");
  allowRepo(repo.dir, home.env);
  expect(readConsent(repo.dir)?.scope).toBeUndefined();
  expect(consentGate(slot, "openrouter")).toHaveProperty("block");
  expect(readEngines(slot).codex).toBeTruthy();
});

test("invalid provider-wide records fail closed", () => {
  const { repo, home } = fixture();
  allowRepo(repo.dir, home.env);
  const base = readConsent(repo.dir)!;
  for (const invalid of [{ scope: "unknown" }, { scope: "provider", provider: "local" }, { scope: "provider", mode: "models", models: [] }]) {
    writeFileSync(consentFile(repo.dir), JSON.stringify({ ...base, ...invalid }));
    expect(readConsent(repo.dir)).toBeUndefined();
  }
});

test("approval from either checkout is shared with existing and future worktrees, including Codex", () => {
  const { repo, home, slot } = fixture();
  allowRepo(repo.dir, home.env);
  expect(consentFile(slot)).toBe(consentFile(repo.dir));
  expect(consentGate(slot, "openrouter")).toHaveProperty("route");
  expect(existsSync(join(slot, ".cheapag"))).toBe(false);
  allowRepo(slot, home.env, ["--codex"]);
  expect(readEngines(repo.dir).codex).toBeTruthy();
  expect(readConsent(repo.dir)?.provider).toBe("openrouter");
  const later = join(repo.dir, ".cheapag", "later");
  repo.git("worktree", "add", "--detach", later, "HEAD");
  expect(readEngines(later)).toEqual(readEngines(slot));
  expect(consentGate(later, "openrouter")).toHaveProperty("route");
  const unrelated = tempRepo(); onTestFinished(unrelated.cleanup);
  expect(readConsent(unrelated.dir)).toBeUndefined();
  expect(readEngines(unrelated.dir)).toEqual({});
});

test("primary legacy approval is inherited without copying jobs; shared renewal overrides stale slot copies", () => {
  const { repo, home, slot } = fixture();
  const legacy = { mode: "all", provider: "openrouter", approvedAt: "legacy", engines: { codex: { approvedAt: "legacy" } } };
  const local = join(repo.dir, ".cheapag", "consent.json");
  writeFileSync(local, JSON.stringify(legacy));
  mkdirSync(join(slot, ".cheapag"));
  writeFileSync(join(slot, ".cheapag", "consent.json"), JSON.stringify({ ...legacy, provider: "deepseek" }));
  expect(readConsent(slot)?.provider).toBe("openrouter");
  expect(readEngines(slot).codex?.approvedAt).toBe("legacy");
  expect(existsSync(consentFile(slot))).toBe(false); // reads do not migrate or approve
  allowRepo(slot, home.env, ["--models", "openrouter/deepseek/deepseek-v4.1-flash"]);
  expect(readConsent(repo.dir)?.mode).toBe("models");
  expect(readConsent(slot)).toEqual(readConsent(repo.dir));
  expect(readEngines(repo.dir).codex?.approvedAt).toBe("legacy");
  expect(JSON.parse(readFileSync(local, "utf8"))).toEqual(legacy);
  for (const broken of ["{}", "not json"]) {
    writeFileSync(consentFile(slot), broken);
    expect(readConsent(slot)).toBeUndefined();
    expect(readEngines(repo.dir)).toEqual({});
  }
});

test("legacy approval in a slot alone does not authorize its primary checkout or sibling", () => {
  const { repo, slot } = fixture();
  mkdirSync(join(slot, ".cheapag"));
  writeFileSync(join(slot, ".cheapag", "consent.json"), JSON.stringify({ mode: "all", provider: "openrouter", approvedAt: "legacy" }));
  expect(readConsent(slot)?.provider).toBe("openrouter");
  expect(readConsent(repo.dir)).toBeUndefined();
  expect(existsSync(consentFile(slot))).toBe(false);
});

test("shared identity works with a bare repository and linked worktrees in paths containing spaces", () => {
  const { repo, home } = fixture();
  const bare = join(home.home, "bare repo.git");
  repo.git("clone", "--bare", repo.dir, bare);
  const slot = join(home.home, "linked checkout");
  execFileSync("git", ["--git-dir", bare, "worktree", "add", "--detach", slot, "HEAD"], { stdio: "pipe" });
  allowRepo(slot, home.env);
  expect(consentFile(slot)).toBe(join(bare, "cheapag", "consent.json"));
  const sibling = join(home.home, "second checkout");
  execFileSync("git", ["--git-dir", bare, "worktree", "add", "--detach", sibling, "HEAD"], { stdio: "pipe" });
  expect(consentGate(sibling, "openrouter")).toHaveProperty("route");
  expect(readConsent(repo.dir)).toBeUndefined();
});

test("allow in a linked worktree resolves the real ignore file, preserves its last line, and succeeds twice", () => {
  const { repo, home, slot } = fixture();
  const exclude = join(repo.dir, ".git", "info", "exclude");
  writeFileSync(exclude, "keep-this-pattern");
  expect(allowRepo(slot, home.env)).toContain(".cheapag/ added");
  allowRepo(slot, home.env, ["--codex"]);
  expect(readFileSync(exclude, "utf8")).toBe("keep-this-pattern\n.cheapag/\n");
  expect(execFileSync("git", ["check-ignore", ".cheapag/jobs/x"], { cwd: slot }).toString().trim()).toBe(".cheapag/jobs/x");
  expect(readEngines(repo.dir).codex).toBeTruthy();
});

test("removing or reordering approved models passes; adding recipients, changing provider, and restoring wider defaults do not", () => {
  const { repo, slot } = fixture();
  writeConsent(repo.dir, { mode: "all", provider: "openrouter", approvedAt: "now" });
  const original = readConsent(slot)!;
  writeFileSync(join(slot, "cheapag.json"), JSON.stringify({ models: {
    implement: "openrouter/z-ai/glm-5.3-flash", research: "openrouter/deepseek/deepseek-v4.1-flash", fallback: [],
  } }));
  expect(routeMoved(slot, original)).toBe(false);
  expect(consentGate(slot, "openrouter")).toHaveProperty("route");
  expect(consentGate(slot, "deepseek")).toHaveProperty("block");
  writeConsent(slot, { mode: "all", provider: "openrouter", approvedAt: "narrow" });
  expect(consentGate(repo.dir, "openrouter")).toHaveProperty("block"); // primary still uses wider defaults
  writeFileSync(join(slot, "cheapag.json"), JSON.stringify({ models: { implement: "openrouter/new/recipient" } }));
  expect(consentGate(slot, "openrouter")).toHaveProperty("block");
});

test("ping reports missing, allowed and stale consent for the actual root; a shared approval enables delegation without copying state", async () => {
  const { repo, home, slot } = fixture();
  const fake = await startFakeOpencode(); onTestFinished(fake.close);
  const server = await startServer({ cwd: repo.dir, logins: { openrouter: "test-key" }, env: { CHEAPAG_OPENCODE_URL: fake.url } });
  onTestFinished(server.close);
  const ping = () => callText(server.client, "ping", { root: slot });
  expect(await ping()).toContain("consent=required");
  expect(fake.recorded.prompts).toHaveLength(0);
  allowRepo(repo.dir, home.env);
  expect(await ping()).toContain("consent=allowed");
  expect(await callText(server.client, "ping")).toContain("consent=allowed");
  fake.script({ edit: "hello.txt", content: "hello\n" }, { finish: { summary: "hello", risks: [], review: [], missing: [] } });
  expect(await callText(server.client, "delegate", { root: slot, task: "Write hello.txt", files: "hello.txt" })).toMatch(/^OK /);
  expect(existsSync(join(slot, ".cheapag", "jobs"))).toBe(true);
  expect(existsSync(join(repo.dir, ".cheapag", "jobs"))).toBe(false);
  expect(existsSync(join(repo.dir, "hello.txt"))).toBe(false);
  writeFileSync(join(slot, "cheapag.json"), JSON.stringify({ models: { implement: "openrouter/new/recipient" } }));
  expect(await ping()).toContain("consent=required");
  allowRepo(repo.dir, homeEnv(server.home), ["--models", "openrouter/not-in-route"]);
  expect(await callText(server.client, "ping")).toContain("consent=blocked");
});
