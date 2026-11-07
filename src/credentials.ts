import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { localServer } from "./config.js";

/**
 * Credentials come only from saved logins in OpenCode's store, written by `cheapag login` (ADR-0004). The local
 * server needs none: it counts as set up once the user config names it, and OpenCode reads its key file, if any.
 */

/** Providers in detection order; `label` is what `cheapag login` shows. */
export const PROVIDERS = [
  { id: "opencode-go", label: "OpenCode Go" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "commandcode", label: "Command Code" },
  { id: "local", label: "Local server" },
  { id: "opencode", label: "OpenCode Zen" },
] as const;

export type Provider = { provider: (typeof PROVIDERS)[number]["id"]; via: "login" | "config" };

export const LOGIN_COMMAND = "npx cheap-agent login";
export const NO_PROVIDER = `FAIL reason: no worker provider; run ${LOGIN_COMMAND}`;

/** OpenCode keeps logins for every installed copy in one shared file. */
function authFile() {
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "auth.json");
}

/** Supported providers with a saved login, in detection order. Only the provider ids are used; keys are never kept or passed on. */
export function savedProviders(): Provider["provider"][] {
  let saved: Record<string, unknown>;
  try {
    saved = existsSync(authFile()) ? JSON.parse(readFileSync(authFile(), "utf8")) : {};
  } catch {
    return []; // an unreadable auth file is the same as no login
  }
  return PROVIDERS.map((p) => p.id).filter((id) => id in saved && id !== "local");
}

/** Whether the user config names a usable local server; a damaged one counts as none here, loadConfig reports it. */
export function localConfigured() {
  try {
    return !!localServer();
  } catch {
    return false;
  }
}

export const providerLabel = (id: Provider["provider"]) => PROVIDERS.find((p) => p.id === id)!.label;

/** The provider the worker uses: a configured local server (set up on purpose, so it wins), else the first saved login. */
export function detectProvider(): Provider | undefined {
  if (localConfigured()) return { provider: "local", via: "config" };
  const [first] = savedProviders();
  return first && { provider: first, via: "login" };
}

/** Strips key-shaped strings (OpenRouter's sk-or-v1-…, DeepSeek/OpenAI-style sk-…) from anything that leaves the process. */
export function redact(text: string) {
  return text.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted]");
}

/**
 * Every secret string in OpenCode's credential store (API keys and OAuth tokens of any shape), for redactLog. Read only by
 * the debug log's writer, which keeps them in memory to mask them; never logged, returned to a tool or written anywhere.
 */
export function savedSecrets(): string[] {
  try {
    const saved = existsSync(authFile()) ? JSON.parse(readFileSync(authFile(), "utf8")) : {};
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        if (v.length >= 8 && !/^(api|oauth|wellknown)$/.test(v)) out.push(v);
      } else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(saved);
    return out;
  } catch {
    return [];
  }
}

// a credential's value after its name, in headers, JSON or key=value text: the name and separator stay, the value goes
const NAMED_SECRET = /\b(authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret)(["']?\s*[:=]\s*["']?)(?:bearer\s+|basic\s+)?[^\s"',;}&]+/gi;

/**
 * Masks a debug log line: the exact `secrets` (the saved keys and the server password, whatever their format), credential
 * values after a name such as Authorization or apiKey, any Bearer token, and redact()'s sk- keys.
 */
export function redactLog(text: string, secrets: string[]) {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return redact(out)
    .replace(NAMED_SECRET, (_, name: string, sep: string) => `${name}${sep}[redacted]`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]");
}
