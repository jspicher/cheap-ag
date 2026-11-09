# Cheap Agent — jspicher fork

Cheap Agent lets Claude Code or Codex send an explicitly requested task to a worker model. The worker researches or edits in an isolated Git worktree, runs the task's checks, and lands successful changes as uncommitted edits for you to review.

This is **[jspicher/cheap-ag](https://github.com/jspicher/cheap-ag)**, based on [muaaz9329/cheap-ag](https://github.com/muaaz9329/cheap-ag). The fork version is **1.3.2-js.1**. The upstream npm package and marketplace are not distribution channels for this fork. See [fork provenance](docs/fork-provenance.md) for adaptations and attribution.

## Explicit requests only

Ask for Cheap Agent by name for the current task, for example:

> Use Cheap Agent to fix this parser bug. Run the parser tests and leave the changes uncommitted.

Installation, connection, a saved API key, and repository consent do **not** authorize automatic delegation. All seven bundled skills require explicit invocation, including status and plan writing. Startup is quiet; update checks run only with `CHEAPAG_UPDATE_CHECK=1`.

Repository consent is a separate prerequisite: `/cheapag:allow` records which provider or models may receive this repository's code. It does not authorize future tasks. Codex workers require independent consent with `/cheapag:allow --codex`.

## What this fork adds

| Feature | Behavior |
| --- | --- |
| Codex worker engine | Select `codex/default`, `codex/<model>`, or an alias for delegation. Codex-only use needs no OpenCode login. |
| Per-task models | Explicit model overrides survive retries, batches, and deferred integration repairs. Changing providers preserves aliases. |
| Task intent | `kind: fix` requires reproduction checks; `change` and its alias `feature` represent new behavior. Step intent overrides call intent, then inference applies. Mixed groups use fix checks if any step is a fix. |
| Multiple repositories | MCP tools accept an absolute `root`. CLI commands support `--repo`. Jobs, consent, and landing remain isolated per checkout, including linked worktrees. |
| Scoped edit guards | Enforcement requires a matching session, prompt, and repository after an actual delegation result. A guard setting alone never redirects unrelated work; missing prompt identity disables prompt-scoped enforcement. |
| Endpoint-bound consent | Custom-endpoint consent includes the canonical destination. Changed endpoints and legacy consent without that identity require renewed consent. |
| Safer landing | A disposable index rehashes affected tracked files before the three-way check, including stale timestamps and `assume-unchanged` entries. The real index, staging, and stash are preserved. Edits racing after the check remain possible. |
| Research evidence | Execution verification requires an exact observed completed command, normalizing line endings and outer whitespace only. Claimed outcomes are separate; unmatched or denied claims reduce confidence. |
| Cost uncertainty | Reports distinguish provider-reported costs, configured estimates, unknown costs, mixed totals, and legacy amounts. Unknown coverage is not shown as a free run. |
| Read-only diagnostics | `doctor` inspects installations and configuration references without making provider calls or changing configuration. |
| Private OpenCode configuration | Generated worker configuration excludes personal command-rewriting plugins while retaining access to existing provider credentials. |

## Build and set up this fork

Requirements: Node.js **20.11+**, Git, and Claude Code or Codex. Windows also needs Git for Windows, including Git Bash.

```bash
git clone https://github.com/jspicher/cheap-ag.git
cd cheap-ag
npm ci
npm run build
npm run typecheck
node dist/index.js
```

In an interactive terminal, the last command starts setup. Choose a provider and model preset, enter the key at the hidden prompt, and follow the Claude registration prompts. Setup generates a stable launcher and local plugin marketplace under `~/.config/cheapag/`. Keep the source checkout at its registered location: the launcher refers to its built runtime. XDG settings can relocate these paths.

Hosted providers: OpenRouter, DeepSeek, OpenCode Go, Command Code, and OpenCode Zen. Custom OpenAI-compatible endpoints are also supported. **Login and provider switching perform live checks and may incur charges.** A key copied from 1Password is saved to OpenCode's local credential store; it is not a continuing link to the vault. Never put a key in chat or a command argument.

Add another provider later with `node dist/index.js login`.

Restart the host and open a **new conversation** after updating. Resumed conversations may retain old instructions even when the MCP server has restarted. Explicit-only skills may be absent from the model's skill list; check Claude's slash-command menu for `/cheapag:`.

For Codex, use the generated local marketplace/plugin rather than the upstream marketplace. Its `codex.mcp.json` starts this fork through the same launcher. Keep the personal Codex plugin disabled when not using it:

```toml
[plugins."cheapag@cheapag"]
enabled = false
```

The Codex host plugin and Codex **worker engine** are separate: Claude can delegate to a Codex worker without enabling the personal Codex host plugin.

## Slash commands and skills

These are the seven bundled skills. Claude uses `/cheapag:<name>`; Codex uses the corresponding `$cheapag:<name>` invocation when the plugin is available.

| Claude command | Purpose |
| --- | --- |
| `/cheapag:allow` | Review and record repository/provider consent. Add `--codex` for independent OpenAI/Codex worker consent. |
| `/cheapag:status` | Show configuration, consent, recent jobs, and spend. |
| `/cheapag:plan-writing` | Write or repair a step-based plan with file scope and executable completion checks. Plans live under `.plan/`. |
| `/cheapag:model` | Choose the main and fallback worker models and supported reasoning efforts. |
| `/cheapag:provider` | List or switch configured providers. A failed live check restores prior provider settings and consent; model-specific consent needs review when changing providers. |
| `/cheapag:hook on` / `/cheapag:hook off` | Configure the scoped edit guard. Enabling it does not authorize delegation or block unrelated work. |
| `/cheapag:clean` | Apply retention cleanup to completed job logs and leftover worktrees, preserving active jobs. |

`delegate`, `research`, `ping`, `jobs`, `reply`, and `land` are **MCP tools**, not additional slash commands. Ask the host to use them for an explicitly requested Cheap Agent task. `reply` answers a blocked worker; `land` handles retained results. `ping` checks server/provider setup, not a successful live model call.

## CLI diagnostics and repository selection

Use the built CLI or the generated `~/.config/cheapag/bin/cheapag.cjs` launcher. From another directory, supply an absolute path to that entry point.

```bash
node dist/index.js doctor --client both --repo /absolute/path/to/project
node dist/index.js status --repo /absolute/path/to/project
node dist/index.js watch --repo /absolute/path/to/project
node dist/index.js allow --repo /absolute/path/to/project
node dist/index.js allow --codex --repo /absolute/path/to/project
```

`doctor` defaults to both clients and the current directory. Disabled-by-choice is healthy. Malformed configuration or broken referenced installations return failure. It reports inspected layers and explicit trust settings, not effective runtime configuration, current cached instructions, or connectivity. It does not repair anything, start a host, or display credential values.

`allow`, `hook`, `status`, `clean`, and `watch` accept `--repo`; relative paths resolve from the invocation directory. Outside a repository, supply a target. Job IDs never trigger sibling searches. MCP `root` must be absolute.

## Models, task kinds, and plans

Project settings live in `cheapag.json`; user settings live in `~/.config/cheapag/config.json`. For example:

```json
{
  "aliases": { "cx": "codex/default" },
  "limits": { "max_turns": 25, "max_minutes": 20 },
  "retention": { "unlanded_worktree_days": 2, "job_log_days": 7 }
}
```

An explicit `model` on `delegate` or `research` wins over saved models, presets, and difficulty tiers. For OpenCode, it must belong to the configured provider and be covered by consent. Explicit models do not use fallback models on rate limits; an applicable stronger escalation route can still handle failed checks.

Plans name files, actions, dependencies, and `done-when` checks. Step-level `kind` takes precedence over call-level `kind`, followed by inference. `feature` aliases `change`; internal integration repairs are fixes. See the [plan-writing skill](plugin/skills/plan-writing/SKILL.md) for the full grammar.

### Codex workers

Request delegation with `model: "codex/default"` to use the configured Codex default, or `codex/<model>` for a specific model. Aliases work too. Install and authenticate the Codex CLI separately; `CHEAPAG_CODEX_BIN` can override its executable path.

Codex runs in the job worktree with workspace-write sandboxing, no approval prompts, and user integrations disabled. Failed checks resume the same thread for bounded self-fixes; escalation raises reasoning effort without lowering an existing higher setting. Batches and deferred repairs retain the selected engine/model.

Codex research is not supported. Codex usage without pricing is reported as unknown cost; time/turn caps still apply. See [Codex worker details](docs/codex-worker.md).

## Custom endpoints and consent migration

Run `node dist/index.js login` and select **Custom endpoint**. Configuration is user-only; a project cannot redirect workers to a new destination.

```json
{
  "local": {
    "base_url": "http://127.0.0.1:8080/v1",
    "model": "your-tool-capable-model",
    "api_key_env": "MY_GATEWAY_KEY",
    "context": 131072
  }
}
```

Use `api_key_file` with an absolute path instead of `api_key_env` if preferred. Omit both for a server requiring no key. Optional `price.input` and `price.output` are USD per million tokens. Missing usable prices mean unknown cost. Plain HTTP is supported only for private/local destinations; public destinations require HTTPS.

Consent fingerprints normalize scheme, hostname, default ports, and trailing slashes while preserving meaningful path differences. URL credentials, query strings, and fragments are rejected. **Renew legacy custom-endpoint consent and consent after a destination change** with `allow --repo <path>`. Aliases and independent Codex consent are preserved.

## Verification, costs, and cleanup

- Successful edits land uncommitted. Review the diff before committing; Cheap Agent does not commit or push for you.
- Research snapshots can omit ignored or unlinked files. Historical handoffs are context, not current evidence. Execution-verified reproduction means the command ran, not that the model's interpretation was independently proven.
- Cost provenance is `reported`, `configured`, `unknown`, or `mixed`. Mixed totals retain the known subtotal and flag incomplete coverage. Legacy records display their recorded amount without inventing provenance.
- Dollar caps apply to known amounts; unknown pricing prevents a complete dollar cap. Time and turn caps apply universally.
- Logs and temporary worktrees live in `.cheapag/`. Retention cleanup runs at server startup and hourly for prepared repositories. Worktree removal explicitly retries transient directory locks for up to eleven seconds, including Windows `EPERM` failures that Node's native retry options can miss. Persistent cleanup errors remain distinct from successful answers or landed edits.
- OpenCode command permissions are guardrails, not an OS sandbox. Allowed project tests run with the developer's authority. Personal OpenCode plugins and config overrides are excluded from worker servers; authentication and explicit endpoint key references remain available.

Set `CHEAPAG_DEBUG=1` before starting the MCP server for redacted diagnostic logs. A successful `doctor`, fake-provider test, or `ping` does not prove live authentication, model behavior, or billing.

## Development and updates

```bash
npm ci
npm run typecheck
npm run build
npm test -- test/opencode.test.ts test/permissions.test.ts test/worker-isolation.test.ts
node test/packed-smoke.mjs
```

The permission and worker-isolation tests run the real bundled OpenCode against a fake local model. Live provider calls are a separate check.

Update this fork from its Git repository, rebuild, regenerate the installed plugin, and refresh the host's cached plugin. Do not use `npx cheap-agent@latest` to update this fork: that selects upstream. Runtime hints print an absolute command for this build; generated skills use the installed launcher. If the runtime disappears, the launcher reports an error instead of substituting upstream. Restart into a new conversation after installation changes. Updating source or `dist/` alone does not refresh cached skill files or an already-running MCP server.

See [CONTRIBUTING.md](CONTRIBUTING.md), [fork provenance](docs/fork-provenance.md), and the [MIT license](LICENSE). Upstream demos and benchmark assets remain as historical material; they are not measurements of this fork.
