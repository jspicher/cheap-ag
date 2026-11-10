import { CLI } from "../src/cli-command.js";
import { consentFile as sharedConsentFile, readConsentRecord } from "../src/consent-storage.js";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vitest";
import { startFakeOpencode, type Action } from "./fake-opencode.js";
import { hermeticHome, removeDir, serverEntry, slow, tempRepo, type Logins } from "./harness.js";

/** `cheapag provider <args>` in a repo, with `logins` saved and `config` as the user config; the live check runs on the fake. */
async function run(args: string[], opts: { logins?: Logins; config?: object; consent?: object; check?: Action[]; legacy?: boolean } = {}) {
  const fake = await startFakeOpencode();
  onTestFinished(fake.close);
  fake.script(...(opts.check ?? [{ usage: { cost: 0.0001 } }]));
  const { home, env } = hermeticHome(opts.logins ?? { "opencode-go": "g", openrouter: "o" });
  onTestFinished(() => removeDir(home));
  const configFile = join(home, "config", "cheapag", "config.json");
  if (opts.config) {
    mkdirSync(join(configFile, ".."), { recursive: true });
    writeFileSync(configFile, JSON.stringify(opts.config));
  }
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  const consentFile = opts.legacy ? join(repo.dir, ".cheapag", "consent.json") : sharedConsentFile(repo.dir);
  if (opts.consent) {
    mkdirSync(join(consentFile, ".."), { recursive: true });
    writeFileSync(consentFile, JSON.stringify(opts.consent));
  }
  const r = await promisify(execFile)(process.execPath, [serverEntry, "provider", ...args], { cwd: repo.dir, env: { ...env, CHEAPAG_OPENCODE_URL: fake.url }, encoding: "utf8" }).catch((e) => e);
  return {
    code: r.code ?? 0,
    stderr: r.stderr as string,
    out: r.stdout as string,
    config: existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : undefined,
    consent: readConsentRecord(repo.dir),
    sharedExists: existsSync(sharedConsentFile(repo.dir)),
    fake,
  };
}

test("with no argument it lists the providers set up, marks the one in use, and names the rest", async () => {
  const r = await run([]);
  expect(r.code, r.stderr).toBe(0);
  expect(r.out).toContain("Providers set up:\n  opencode-go  OpenCode Go  (in use)\n  openrouter  OpenRouter\n");
  expect(r.out).toContain(`Not set up: DeepSeek, Command Code, OpenCode Zen, Custom endpoint. Add one with ${CLI} login`);
}, slow(30_000));

test("switching moves the repo's consent with its mode, shows what it covers, live-checks, and the choice sticks", async () => {
  const aliases = { glm: "openrouter/z-ai/glm-5.3", cx: "codex/default" };
  const engines = { codex: { approvedAt: "2026-11-01T00:00:00Z" } };
  const r = await run(["openrouter"], { config: { test_cmd: "make", aliases }, consent: { mode: "all", provider: "opencode-go", approvedAt: "2026-11-01T00:00:00Z", engines } });
  expect(r.code, r.stderr).toBe(0);
  expect(r.out).toContain("Switching the worker from OpenCode Go to OpenRouter");
  expect(r.out).toMatch(/consent moved to OpenRouter \(all models\); it now covers:\n  send: code from this repo → OpenRouter: /);
  expect(r.out).toContain("  retention: depends on the upstream provider OpenRouter routes to");
  expect(r.out).toContain("✓ Now using OpenRouter; the next job runs on it");
  expect(r.config).toEqual({ test_cmd: "make", aliases, provider: "openrouter" });
  expect(r.consent).toMatchObject({ mode: "all", provider: "openrouter", engines });
  expect(r.fake.recorded.sessions[0].model).toMatchObject({ providerID: "openrouter" });
  // detection follows the choice although OpenCode Go comes first in order
  expect((await run([], { config: r.config })).out).toContain("  openrouter  OpenRouter  (in use)");
}, slow(60_000));

test("switching providers does not transfer provider-wide OpenRouter approval", async () => {
  const consent = { mode: "all", scope: "provider", provider: "openrouter", approvedAt: "now" };
  const r = await run(["opencode-go"], { config: { provider: "openrouter" }, consent });
  expect(r.code, r.stderr).toBe(0);
  expect(r.consent).toEqual(consent);
  expect(r.out).toContain("run /cheapag:allow here for OpenCode Go");
  expect(r.out).not.toContain("consent moved");
}, slow(30_000));

test("a failed live check puts the previous provider and consent back", async () => {
  const consent = { mode: "zdr-only", provider: "opencode-go", approvedAt: "2026-11-01T00:00:00Z", engines: { codex: { approvedAt: "2026-10-31T00:00:00Z" } } };
  const config = { preset: "balanced", aliases: { cx: "codex/default" } };
  const r = await run(["openrouter"], { config, consent, check: [{ error: { name: "APIError", message: "402 Insufficient credits" } }] });
  expect(r.code, r.stderr).toBe(1);
  expect(r.out).toContain("✗ the account has no credit (402 Insufficient credits)");
  expect(r.out).toContain("Still using OpenCode Go; nothing changed");
  expect(r.config).toEqual(config);
  expect(r.consent).toEqual(consent);
}, slow(60_000));

test("a failed provider switch from legacy consent removes the new shared record and preserves legacy approval", async () => {
  const consent = { mode: "all", provider: "opencode-go", approvedAt: "legacy", engines: { codex: { approvedAt: "legacy" } } };
  const r = await run(["openrouter"], { legacy: true, consent, check: [{ error: { name: "APIError", message: "402 Insufficient credits" } }] });
  expect(r.code).toBe(1);
  expect(r.consent).toEqual(consent);
  expect(r.sharedExists).toBe(false);
}, slow(60_000));

test("a provider with no saved key points to login; an explicit model consent is not carried; same provider and bad names are said", async () => {
  const missing = await run(["deepseek"]);
  expect(missing.code).toBe(1);
  expect(missing.out).toContain(`✗ DeepSeek is not set up yet; run ${CLI} login and pick it`);
  expect(missing.config).toBeUndefined();

  const models = await run(["OpenRouter"], { consent: { mode: "models", models: ["opencode-go/kimi-k3"], provider: "opencode-go", approvedAt: "2026-11-01T00:00:00Z" } });
  expect(models.code, models.stderr).toBe(0);
  expect(models.out).toContain("! This repo's consent names OpenCode Go models (models opencode-go/kimi-k3); run /cheapag:allow here for OpenRouter");
  expect(models.consent?.provider).toBe("opencode-go");

  expect((await run(["opencode-go"])).out).toContain("✓ already using OpenCode Go");
  const bad = await run(["gemini"]);
  expect(bad.code).toBe(1);
  expect(bad.out).toContain('✗ "gemini" is not a provider; use one of opencode-go, openrouter');
}, slow(90_000));
