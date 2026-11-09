import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "toml";
import { installPaths } from "./install.js";
import { redact } from "./credentials.js";
import { repoTarget } from "./cli-repo.js";

/** Read-only inspection of named layers. This does not evaluate host precedence or start hosts. */
export function doctor(args: string[], out: (line: string) => void = console.log): number {
  let client = "both", repo = process.cwd();
  try { const parsed = repoTarget(args); args = parsed.args; repo = parsed.root; }
  catch (err) { out((err as Error).message); return 1; }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--client" && ["codex", "claude", "both"].includes(args[i + 1])) client = args[++i];
    else { out("usage: cheapag doctor [--client codex|claude|both] [--repo <path>]"); return 1; }
  }
  let failed = false;
  const say = (s: string) => out(redact(s));
  const broken = (s: string) => { failed = true; say(`BROKEN ${s}`); };
  const read = (file: string): any => {
    say(`inspect: ${file}`);
    if (!existsSync(file)) { say("  absent"); return undefined; }
    try {
      const value = file.endsWith(".toml") ? parse(readFileSync(file, "utf8")) : JSON.parse(readFileSync(file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected table");
      return value;
    }
    catch { broken(`malformed or unreadable configuration: ${file}`); return undefined; }
  };
  const checkPath = (file: string) => { if (!existsSync(file)) broken(`missing referenced path: ${file}`); else say(`  present: ${file}`); };
  const checkServer = (server: any, base: string) => {
    if (!server || typeof server !== "object" || Array.isArray(server)) { broken("malformed Cheap Agent server registration"); return; }
    if (typeof server.command === "string" && isAbsolute(server.command)) checkPath(server.command);
    for (const arg of Array.isArray(server.args) ? server.args.slice(0, 1) : []) {
      if (typeof arg === "string" && !arg.startsWith("-") && !arg.includes("://") && /\.(?:c?js|mjs)$/.test(arg)) checkPath(resolve(base, arg));
    }
  };
  const { launcher, marketplace } = installPaths();
  say("cheapag doctor: read-only installation inspection; no runtime configuration or connectivity claim");
  say(`runtime: ${process.execPath}`);
  say(`launcher: ${launcher}`);
  if (existsSync(launcher)) {
    try {
      const entry = readFileSync(launcher, "utf8").match(/^const entry = (.+);$/m)?.[1];
      if (!entry) broken("unrecognized generated launcher");
      else checkPath(JSON.parse(entry));
    } catch { broken("unreadable generated launcher"); }
  } else say("  not installed");
  if (existsSync(marketplace)) {
    const market = read(join(marketplace, ".claude-plugin/marketplace.json"));
    for (const item of market?.plugins ?? []) if (item.name === "cheapag" && typeof item.source === "string") checkPath(resolve(marketplace, item.source));
    const plugin = join(marketplace, "cheapag");
    for (const host of client === "both" ? ["codex", "claude"] : [client]) {
      const file = join(plugin, `.${host}-plugin/plugin.json`);
      checkPath(file);
      const manifest = read(file);
      for (const key of ["skills", "hooks", "mcpServers"]) if (typeof manifest?.[key] === "string") {
        const path = resolve(plugin, manifest[key]); checkPath(path);
        if (path.endsWith(".json")) read(path);
      }
    }
    const mcp = read(join(plugin, "codex.mcp.json"));
    checkServer(mcp?.mcpServers?.cheapag, plugin);
  }
  const inspectLayer = (file: string, host: string) => {
    const config = read(file);
    if (!config) return;
    const plugin = host === "codex" ? config.plugins?.["cheapag@cheapag"]?.enabled : config.enabledPlugins?.["cheapag@cheapag"];
    say(`  cheapag plugin: ${plugin === false ? "disabled by choice (normal)" : plugin === true ? "enabled in this layer" : "not specified"}`);
    const servers = config.mcp_servers ?? config.mcpServers ?? {};
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) { broken("malformed MCP registrations table"); return; }
    const matches = Object.entries(servers).filter(([name, server]: [string, any]) => /cheapag|cheap-agent/i.test(name) || /cheapag|cheap-agent/i.test(JSON.stringify([server?.command, server?.args])));
    if (matches.length > 1 || (plugin === true && matches.length && host === "codex")) say("  warning: duplicate Cheap Agent registrations in this layer");
    for (const [, server] of matches) checkServer(server, dirname(file));
    const source = config.marketplaces?.cheapag?.source;
    if (typeof source === "string" && isAbsolute(source)) checkPath(source);
    if (plugin === true) { checkPath(launcher); checkPath(marketplace); }
    for (const [path, value] of Object.entries(config.projects ?? {}) as [string, any][]) {
      if (["trusted", "untrusted"].includes(value?.trust_level)) say(`  explicit trust: ${path} = ${value.trust_level}`);
      const projectServer = value?.mcpServers?.cheapag;
      if (projectServer) checkServer(projectServer, path);
    }
  };
  if (client !== "claude") {
    inspectLayer(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "codex");
    // Report ancestors individually. Codex decides whether trusted project layers apply.
    const ancestors: string[] = [];
    for (let dir = repo;; dir = dirname(dir)) { ancestors.unshift(dir); if (dirname(dir) === dir) break; }
    for (const dir of ancestors) inspectLayer(join(dir, ".codex/config.toml"), "codex");
    const system = process.platform === "win32" ? join(process.env.ProgramData || "C:/ProgramData", "codex/config.toml") : "/etc/codex/config.toml";
    inspectLayer(system, "codex");
  }
  if (client !== "codex") {
    const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    for (const file of [join(home, "settings.json"), join(homedir(), ".claude.json"), join(repo, ".claude/settings.json"), join(repo, ".claude/settings.local.json"), join(repo, ".mcp.json")]) inspectLayer(file, "claude");
  }
  say("Scope: inspected files only; host flags, managed policy, environment overrides and live enablement are not resolved.");
  return failed ? 1 : 0;
}
