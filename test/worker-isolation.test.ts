import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, vi } from "vitest";
import { ensureOpencode, stopOpencode } from "../src/opencode.js";
import { workerRuleset } from "../src/permissions.js";
import { fullRoute } from "../src/routing.js";
import { releaseDirectory, runSession } from "../src/worker.js";
import { createWorktree, removeWorktree } from "../src/workspace.js";
import { startFakeLlm } from "./fake-llm.js";
import { hermeticHome, removeDir, slow, tempRepo } from "./harness.js";

test("private workers ignore global command rewriters and release linked worktrees while the server stays alive", async () => {
  const llm = await startFakeLlm();
  const home = hermeticHome();
  const repo = tempRepo();
  for (const [key, value] of Object.entries(home.env)) if (key.startsWith("XDG_")) vi.stubEnv(key, value);
  vi.stubEnv("CHEAPAG_OPENCODE_URL", "");
  const config = join(home.home, "config");
  mkdirSync(join(config, "cheapag"), { recursive: true });
  writeFileSync(join(config, "cheapag/config.json"), JSON.stringify({ local: { base_url: llm.url, model: "fake" } }));
  mkdirSync(join(config, "opencode/plugins"), { recursive: true });
  // Reproduce the personal RTK plugin's pre-permission rewrite without depending on RTK.
  writeFileSync(join(config, "opencode/plugins/rewrite.js"), `export const Rewrite = async ({ $ }) => {
    await $\`pwd\`.quiet();
    return ({
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") output.args.command = "blocked-wrapper " + output.args.command;
    }
  }); };`);
  const inherited = join(home.home, "inherited.json");
  const override = { plugin: [pathToFileURL(join(config, "opencode/plugins/rewrite.js")).href] };
  writeFileSync(inherited, JSON.stringify(override));
  vi.stubEnv("OPENCODE_CONFIG", inherited);
  vi.stubEnv("OPENCODE_CONFIG_CONTENT", JSON.stringify(override));
  vi.stubEnv("OPENCODE_TEST_HOME", home.home);
  mkdirSync(join(home.home, ".opencode/plugins"), { recursive: true });
  writeFileSync(join(home.home, ".opencode/plugins/rewrite.js"), `export const Rewrite = async () => ({
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") output.args.command = "home-wrapper " + output.args.command;
    }
  });`);
  try {
    const route = fullRoute("local");
    const server = await ensureOpencode({ provider: "local", via: "config" }, repo.dir, route);
    for (const id of ["jisolated1", "risolated2"]) {
      const tree = createWorktree(repo.dir, id, []);
      const completed: string[] = [];
      llm.script({ tool: "bash", args: { command: "git diff -- README.md", description: "inspect diff" } });
      const result = await runSession({ opencode: server, directory: tree.path, model: route.implement,
        permission: workerRuleset(), prompt: "inspect diff", onEvent: event => {
          if (event.type !== "message.part.updated") return;
          const part = event.properties.part;
          if (part.type === "tool" && part.tool === "bash" && part.state.status === "completed") completed.push(String(part.state.input.command));
        } });
      await releaseDirectory(tree.path);
      // The server must remain usable for the next job, without retaining this directory.
      removeWorktree(repo.dir, tree);
      expect(existsSync(tree.path)).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.rejections).toEqual([]);
      expect(completed).toContain("git diff -- README.md");
    }
  } finally {
    stopOpencode(true);
    vi.unstubAllEnvs();
    await llm.close();
    repo.cleanup();
    removeDir(home.home);
  }
}, slow(90_000));
