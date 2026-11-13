import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, onTestFinished, test, vi } from "vitest";
import { modelWarnings } from "../src/consent.js";
import { consentFile } from "../src/consent-storage.js";
import { foreignModels } from "../src/routing.js";
import { startFakeOpencode } from "./fake-opencode.js";
import { callText, hermeticHome, homeEnv, removeDir, serverEntry, startServer, tempRepo } from "./harness.js";

function configFixture(config: object, user: object = {}) {
  const repo = tempRepo();
  const { home, env } = hermeticHome();
  mkdirSync(join(home, "config", "cheapag"), { recursive: true });
  writeFileSync(join(home, "config", "cheapag", "config.json"), JSON.stringify(user));
  writeFileSync(join(repo.dir, "cheapag.json"), JSON.stringify(config));
  vi.stubEnv("XDG_CONFIG_HOME", env.XDG_CONFIG_HOME);
  onTestFinished(() => { vi.unstubAllEnvs(); removeDir(home); repo.cleanup(); });
  return repo;
}

test("foreign model roles and individual fallbacks are detected without treating efforts as models", () => {
  expect(foreignModels("opencode-go", {
    implement: "opencode-go/main", research: "openrouter/research", hard: "codex/default",
    fallback: ["opencode-go/next", "opencode/other"], variants: { "openrouter/unused": "high" },
  })).toEqual([
    { role: "hard", name: "codex/default" }, { role: "research", name: "openrouter/research" },
    { role: "fallback", name: "opencode/other" },
  ]);
});

test("warnings identify each role's configured replacement, including tier inheritance and filtered fallbacks", () => {
  const repo = configFixture({ models: {
    implement: "openrouter/wrong-main", medium: "opencode-go/medium", hard: "deepseek/wrong-hard",
    research: "openrouter/wrong-research", escalation: "deepseek/wrong-escalation",
    fallback: ["openrouter/wrong-fallback", "opencode-go/next"],
  } });
  const warnings = modelWarnings("opencode-go", repo.dir);
  expect(warnings).toHaveLength(5);
  expect(warnings.find(w => w.startsWith("models.implement"))).toContain("configured implement route: opencode-go/deepseek-v4.1-flash");
  expect(warnings.find(w => w.startsWith("models.hard"))).toContain("configured hard route: opencode-go/medium");
  expect(warnings.find(w => w.startsWith("models.research"))).toContain("configured research route: opencode-go/qwen3.8-flash");
  expect(warnings.find(w => w.startsWith("models.escalation"))).toContain("configured escalation route: opencode-go/deepseek-v4-pro");
  expect(warnings.find(w => w.startsWith("models.fallback"))).toContain("configured fallback route: opencode-go/next");
});

test("repo overrides win over user models and unused foreign/Codex aliases are quiet, including from subdirectories", () => {
  const repo = configFixture({ models: { implement: "opencode-go/ours" }, aliases: { cx: "codex/default", other: "openrouter/other" } },
    { models: { implement: "openrouter/overridden" } });
  const nested = join(repo.dir, "nested");
  mkdirSync(nested);
  expect(modelWarnings("opencode-go", nested)).toEqual([]);
});

test("warnings use effective preset settings and say none when every fallback is ignored", () => {
  const repo = configFixture({ models: { fallback: ["openrouter/wrong"] } }, { preset: "strongest" });
  expect(modelWarnings("opencode-go", repo.dir)).toEqual([
    expect.stringContaining("models.fallback names openrouter/wrong, which is ignored on OpenCode Go; configured fallback route: none."),
  ]);
});

test("local endpoints report no escalation model, and malformed settings are left to normal config errors", () => {
  const repo = configFixture({ models: { escalation: "openrouter/ignored" } }, { local: { base_url: "http://localhost:11434/v1", model: "ours" } });
  expect(modelWarnings("local", repo.dir)[0]).toContain("configured escalation route: none.");
  writeFileSync(join(repo.dir, "cheapag.json"), "{");
  expect(modelWarnings("local", repo.dir)).toEqual([]);
});

async function scenario() {
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  writeFileSync(join(repo.dir, "cheapag.json"), JSON.stringify({
    models: { implement: "openrouter/wrong", research: "deepseek/wrong" },
    aliases: { quick: "opencode-go/override", cx: "codex/default" },
  }));
  const fake = await startFakeOpencode();
  onTestFinished(fake.close);
  const server = await startServer({ cwd: repo.dir, logins: { "opencode-go": "dummy" }, env: { CHEAPAG_OPENCODE_URL: fake.url }, allow: [] });
  onTestFinished(server.close);
  const env = { ...homeEnv(server.home), CHEAPAG_OPENCODE_URL: fake.url };
  return { repo, fake, server, env };
}

test("ping, status and model --list expose warnings without changing configuration or consent", async () => {
  const { repo, fake, server, env } = await scenario();
  const config = readFileSync(join(repo.dir, "cheapag.json"), "utf8");
  const consent = readFileSync(consentFile(repo.dir), "utf8");
  const ping = await callText(server.client, "ping");
  expect(ping).toMatch(/^OK cheapag .*consent=allowed/);
  expect(ping).toContain("\n\n! models.implement names openrouter/wrong");
  expect(ping).toContain("configured research route: opencode-go/qwen3.8-flash");
  const status = execFileSync(process.execPath, [serverEntry, "status"], { cwd: repo.dir, env }).toString();
  expect(status).toContain("\n! models.implement names openrouter/wrong");
  const { stdout } = await promisify(execFile)(process.execPath, [serverEntry, "model", "--list"], { cwd: repo.dir, env });
  expect(stdout).toContain("! models.research names deepseek/wrong");
  expect(readFileSync(join(repo.dir, "cheapag.json"), "utf8")).toBe(config);
  expect(readFileSync(consentFile(repo.dir), "utf8")).toBe(consent);
  expect(fake.recorded.sessions).toEqual([]);
});

test("Codex aliases keep their engine gate and do not claim to use the OpenCode role configuration", async () => {
  const { fake, server } = await scenario();
  const text = await callText(server.client, "delegate", { task: "write hello", files: "hello.txt", done_when: "hello exists", model: "cx" });
  expect(text).toContain("allow --codex");
  expect(text).not.toContain("! models.");
  expect(fake.recorded.sessions).toEqual([]);
});

test("delegate aliases and research overrides still select their requested models; warnings stay outside receipts", async () => {
  const { repo, fake, server } = await scenario();
  fake.script({ edit: "hello.txt", content: "hello\n" }, { finish: { summary: "wrote hello", risks: [], review: [], missing: [] } });
  const text = await callText(server.client, "delegate", { task: "write hello", files: "hello.txt", done_when: "hello exists", model: "quick" });
  expect(text).toMatch(/^OK /);
  expect(text).toContain("\n\n! models.implement");
  const jobs = join(repo.dir, ".cheapag", "jobs");
  const jobDir = join(jobs, readdirSync(jobs)[0]);
  expect(JSON.parse(readFileSync(join(jobDir, "result.json"), "utf8")).models.final).toBe("opencode-go/override");
  expect(readFileSync(join(jobDir, "result.txt"), "utf8")).not.toContain("! models.");
  fake.script({ text: "```cheapag-research\nstatus: answer\nconfidence: high\nnotes: hello is present\n```" });
  const research = await callText(server.client, "research", { question: "Is hello present?", model: "quick" });
  expect(research).toMatch(/^ANSWER /);
  expect(research).toContain("\n\n! models.implement");
  expect(research).toContain("\n! models.research");
  const researchDir = join(jobs, research.match(/^ANSWER (\S+)/)![1]);
  expect(JSON.parse(readFileSync(join(researchDir, "research.json"), "utf8")).models.final).toBe("opencode-go/override");
  expect(readFileSync(join(researchDir, "result.txt"), "utf8")).not.toContain("! models.");
});
