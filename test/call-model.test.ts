import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { loadConfig } from "../src/config.js";
import { startFakeOpencode } from "./fake-opencode.js";
import { callText, startServer, tempRepo, type Logins } from "./harness.js";

// delegate's and research's `model`: a provider/model name or a config alias, picked per call

const PLAN = `# Hello
## 1 hello
files: hello.txt
do: write hello.txt
done-when: hello exists
`;
const EDIT = { edit: "hello.txt", content: "hi\n" };
const FINISH = { finish: { summary: "wrote hello", risks: [], review: [], missing: [] } };

/** An approved repo (`allow` = the CLI's allow arguments) with a plan, a fake worker and a server. */
async function scenario(opts: { logins?: Logins; allow?: string[]; config?: unknown } = {}) {
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  writeFileSync(join(repo.dir, "plan.md"), PLAN);
  if (opts.config) writeFileSync(join(repo.dir, "cheapag.json"), JSON.stringify(opts.config));
  const fake = await startFakeOpencode();
  onTestFinished(fake.close);
  const server = await startServer({ cwd: repo.dir, env: { CHEAPAG_OPENCODE_URL: fake.url }, logins: opts.logins ?? { "opencode-go": "k" }, allow: opts.allow ?? [] });
  onTestFinished(server.close);
  const delegate = (model?: string) => callText(server.client, "delegate", { plan: "plan.md", steps: "1", ...(model !== undefined && { model }) });
  return { repo, fake, server, delegate };
}

/** No job folder was made and nothing reached OpenCode. */
function expectUntouched(repo: { dir: string }, fake: { recorded: { requests: unknown[] } }) {
  const jobs = join(repo.dir, ".cheapag", "jobs");
  expect(existsSync(jobs) ? readdirSync(jobs) : []).toEqual([]);
  expect(fake.recorded.requests).toEqual([]);
}

test("a provider/model name runs the job on that model alone: no fallbacks, the escalation model kept", async () => {
  const { repo, fake, delegate } = await scenario({ logins: { openrouter: "k" } });
  fake.script(EDIT, FINISH);
  const text = await delegate("openrouter/z-ai/glm-5.3");
  expect(text).toMatch(/^OK /);
  expect(fake.recorded.sessions[0].model).toEqual({ providerID: "openrouter", id: "z-ai/glm-5.3" });
  // OpenCode keeps the consented configuration and also declares the picked model (OpenRouter lists each one, for its
  // routing options), so it never reboots under other jobs; only the picked model ran
  const config = JSON.parse(readFileSync(join(repo.dir, ".cheapag", "opencode", "opencode.json"), "utf8"));
  expect(config.provider.openrouter.models["z-ai/glm-5.3"].options).toBeDefined();
  expect(fake.recorded.sessions.map((s) => s.model?.id)).toEqual(["z-ai/glm-5.3"]);
});

test("a picked model that hits a provider limit stops as BUDGET instead of falling back to another model", async () => {
  const { fake, delegate } = await scenario();
  fake.script({ retry: { reason: "account_rate_limit", message: "Resets in 2h" } });
  const text = await delegate("opencode-go/glm-5.3");
  expect(text.split("\n")[0]).toMatch(/^BUDGET j\w{4} step=1 /);
  expect(fake.recorded.sessions).toHaveLength(1);
  expect(fake.recorded.prompts.every((p) => p.model === undefined || p.model.modelID === "glm-5.3")).toBe(true);
});

test("an alias from the config resolves to its model; an unknown name lists the aliases and runs nothing", async () => {
  const { repo, fake, delegate } = await scenario({ config: { aliases: { glm: "opencode-go/glm-5.3" } } });
  const unknown = await delegate("kimi");
  expect(unknown).toMatch(/^FAIL /);
  expect(unknown).toContain("model kimi is neither a provider/model name nor an alias (aliases: glm)");
  expectUntouched(repo, fake);
  fake.script(EDIT, FINISH);
  expect(await delegate("glm")).toMatch(/^OK /);
  expect(fake.recorded.sessions[0].model).toEqual({ providerID: "opencode-go", id: "glm-5.3" });
});

test("a model on another provider than the login is refused before anything runs", async () => {
  const { repo, fake, delegate } = await scenario();
  const text = await delegate("openrouter/z-ai/glm-5.3");
  expect(text).toMatch(/^FAIL /);
  expect(text).toContain("model openrouter/z-ai/glm-5.3 is on openrouter, but Cheap Agent runs on OpenCode Go; pick a opencode-go/ model");
  expectUntouched(repo, fake);
});

test("a model the repo's consent does not list is refused; one it lists runs", async () => {
  const { repo, fake, delegate } = await scenario({ allow: ["--models", "opencode-go/deepseek-v4.1-flash,opencode-go/glm-5.3"] });
  const text = await delegate("opencode-go/kimi-k3");
  expect(text).toMatch(/^FAIL /);
  expect(text).toContain("model opencode-go/kimi-k3 is not allowed under this repo's consent (models opencode-go/deepseek-v4.1-flash, opencode-go/glm-5.3)");
  expectUntouched(repo, fake);
  fake.script(EDIT, FINISH);
  expect(await delegate("opencode-go/glm-5.3")).toMatch(/^OK /);
  expect(fake.recorded.sessions[0].model).toEqual({ providerID: "opencode-go", id: "glm-5.3" });
});

test("on OpenRouter with zero-retention only, a picked model keeps the zdr routing", async () => {
  const { repo, fake, delegate } = await scenario({ logins: { openrouter: "k" }, allow: ["--zdr-only"] });
  fake.script(EDIT, FINISH);
  expect(await delegate("openrouter/z-ai/glm-5.3")).toMatch(/^OK /);
  const config = JSON.parse(readFileSync(join(repo.dir, ".cheapag", "opencode", "opencode.json"), "utf8"));
  expect(config.provider.openrouter.models["z-ai/glm-5.3"].options.provider).toMatchObject({ data_collection: "deny", zdr: true });
});

test("a picked model runs while another job holds OpenCode: it needs no reboot into another configuration", async () => {
  const { server, fake, delegate } = await scenario();
  fake.script({ wait: 2_000 }, EDIT, FINISH);
  const first = await callText(server.client, "delegate", { plan: "plan.md", steps: "1", wait: false });
  expect(first).toMatch(/^RUNNING /);
  fake.script(EDIT, FINISH);
  const text = await delegate("opencode-go/glm-5.3");
  expect(text).not.toContain("model configuration changed");
  expect(fake.recorded.sessions.map((s) => s.model?.id)).toContain("glm-5.3");
});

test("a picked model the running server has not loaded, while another job holds it: the refusal says so", async () => {
  // on OpenRouter each model is declared with its routing options, so an unloaded one changes OpenCode's config
  const { server, fake, delegate } = await scenario({ logins: { openrouter: "k" } });
  fake.script({ wait: 2_000 }, EDIT, FINISH);
  const first = await callText(server.client, "delegate", { plan: "plan.md", steps: "1", wait: false });
  expect(first).toMatch(/^RUNNING /);
  const text = await delegate("openrouter/minimax/minimax-m3"); // not in the default route
  expect(text).toMatch(/^FAIL reason: model openrouter\/minimax\/minimax-m3 is not loaded in the running OpenCode server, and loading it needs a restart while jobs are running; wait for them to finish, or pick a model from the configured route or an alias for one \(loaded: openrouter\/\S+/);
  expect(text).not.toContain("consent or cheapag.json models");
  expect(fake.recorded.sessions.map((s) => s.model?.id)).not.toContain("minimax/minimax-m3");
});

test("config: aliases map short names to provider/model names", () => {
  const repo = tempRepo();
  onTestFinished(repo.cleanup);
  const load = (config: object) => {
    writeFileSync(join(repo.dir, "cheapag.json"), JSON.stringify(config));
    return loadConfig(repo.dir);
  };
  expect(load({ aliases: { glm: "openrouter/z-ai/glm-5.3", "ds-flash": "openrouter/deepseek/deepseek-v4.1-flash" } }).aliases)
    .toMatchObject({ glm: "openrouter/z-ai/glm-5.3", "ds-flash": "openrouter/deepseek/deepseek-v4.1-flash" });
  expect(() => load({ aliases: ["glm"] })).toThrow("aliases must be an object");
  expect(() => load({ aliases: { glm: "glm-5.3" } })).toThrow("aliases.glm must be a provider/model name");
  // a slash would make an alias look like a provider/model name
  expect(() => load({ aliases: { "z-ai/glm": "openrouter/z-ai/glm-5.3" } })).toThrow('alias "z-ai/glm" may only use letters');
});

test("research takes the same model argument", async () => {
  const { fake, server } = await scenario();
  fake.script({ text: "```cheapag-research\nanswer: hello.txt is written by step 1\nconfidence: high\n```" });
  const text = await callText(server.client, "research", { question: "what writes hello.txt?", model: "opencode-go/glm-5.3" });
  expect(text).not.toMatch(/^FAIL /);
  expect(fake.recorded.sessions[0].model).toEqual({ providerID: "opencode-go", id: "glm-5.3" });
});
