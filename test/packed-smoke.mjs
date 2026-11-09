import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const temp = mkdtempSync(join(tmpdir(), "cheapag-packed-"));
assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|TOKEN|SECRET|PASSWORD|CHEAPAG|OPENCODE|CODEX|CLAUDE/i.test(key)));
Object.assign(env, { HOME: temp, USERPROFILE: temp, XDG_CONFIG_HOME: join(temp, "config"), XDG_DATA_HOME: join(temp, "data"), XDG_STATE_HOME: join(temp, "state"), XDG_CACHE_HOME: join(temp, "cache"), CODEX_HOME: join(temp, "codex"), CLAUDE_CONFIG_DIR: join(temp, "claude") });
const run = (exe, args, options = {}) => execFileSync(exe, args, { cwd: temp, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmRun = args => run(npm, args, { cwd: process.cwd(), shell: process.platform === "win32" });
  const packed = JSON.parse(npmRun(["pack", "--json", "--pack-destination", temp]));
  npmRun(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", temp, join(temp, packed[0].filename)]);
  const pkg = join(temp, "node_modules/cheap-agent");
  const entry = join(pkg, "dist/index.js");
  const repo = join(temp, "repo"); mkdirSync(repo); run("git", ["init", repo]);
  assert.match(run(process.execPath, [entry, "status", "--repo", repo]), /cheapag 1\.3\.2-js\.1/);
  assert.match(run(process.execPath, [entry, "doctor", "--repo", repo]), /read-only installation inspection/);
  // Generate from the packed artifact in this child only; no host registration or startup.
  const generate = `import { writePlugin } from ${JSON.stringify(pathToFileURL(join(pkg, "dist/install.js")).href)}; writePlugin(${JSON.stringify(entry)}, process.execPath);`;
  run(process.execPath, ["--input-type=module", "-e", generate]);
  const launcher = join(temp, "config/cheapag/bin/cheapag.cjs");
  const state = JSON.stringify({ session_id: "s", prompt_id: "p", cwd: repo, tool_name: "Write", tool_input: { file_path: "a.ts", content: "x\n".repeat(100) } });
  assert.equal(run(process.execPath, [launcher, "hook", "guard"], { input: state }), "");
  assert.equal(run(process.execPath, [launcher, "hook", "context", "codex"], { input: "" }), "");
  mkdirSync(env.CODEX_HOME); const config = join(env.CODEX_HOME, "config.toml");
  writeFileSync(config, '[plugins."cheapag@cheapag"]\nenabled = false\n');
  const before = readFileSync(config);
  assert.match(run(process.execPath, [launcher, "doctor", "--repo", repo]), /disabled by choice/);
  assert.deepEqual(readFileSync(config), before);
  console.log("Packed CLI and generated launcher smoke passed in a temporary home.");
} finally { rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
