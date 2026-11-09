# Cheap Agent fork plugin for Claude Code and Codex

This plugin belongs to the jspicher fork. Use the fork's setup to generate a local marketplace and launcher from its built runtime. The source plugin command pins are installer templates, not instructions to install the upstream npm package. Setup rewrites executable commands and prose hints to the installed fork's launcher.

Cheap Agent requires an explicit user request for the current task. Installation, connection, and repository/provider consent never authorize automatic delegation. Startup is quiet. All seven skills disable implicit invocation.

## Commands

| Claude command | Purpose |
| --- | --- |
| `/cheapag:allow` | Review and record repository consent; `--codex` grants independent Codex worker consent. |
| `/cheapag:status` | Show configuration, consent, recent jobs, spend, and available context/cache metrics. |
| `/cheapag:plan-writing` | Write or repair a plan with file scopes and executable checks. |
| `/cheapag:model` | Choose main/fallback models and supported thinking efforts. |
| `/cheapag:provider` | Switch configured providers; a live check may incur charges. |
| `/cheapag:hook on` / `off` | Configure the session/prompt/repository-scoped edit guard; this does not authorize delegation. |
| `/cheapag:clean` | Apply retention cleanup while preserving active jobs. |

Codex uses the corresponding `$cheapag:<name>` skills when the plugin is enabled. Explicit-only skills can be absent from the model-visible list; check the host's command menu.

The MCP tools are `ping`, `delegate`, `research`, `jobs`, `reply`, and `land`. These are not extra slash commands. Codex worker models are supported by `delegate`, not `research`.

## Model and provider selection

Run `npx -y cheap-agent@1.3.2 model` in a terminal for the full model selector, or use `/cheapag:model`. Setup replaces that template command with this installation's launcher. Selecting an effort stores an explicit variant; choosing default leaves effort to OpenCode and the provider.

To add a provider, run `npx -y cheap-agent@1.3.2 login` in a terminal and enter its API key at the hidden prompt. Login performs a live check. Never send a key in chat. A provider switch preserves aliases and separate Codex consent; model-specific consent may require renewal.

Repository settings in `cheapag.json` override user settings in `~/.config/cheapag/config.json`. An explicit per-call model takes precedence over saved settings. Consent and current-task authorization remain separate.

## Updates and diagnostics

Build and update from the fork repository. A missing runtime produces an actionable error instead of falling back to upstream npm. Regenerate the plugin and refresh the host cache when skills change; restart into a new conversation to load new instructions.

Run `npx -y cheap-agent@1.3.2 doctor --client both` for a read-only installation report. It does not establish connectivity or prove that a running conversation loaded the current files.

See the [fork README](https://github.com/jspicher/cheap-ag#readme) for setup, endpoint consent migration, cost provenance, and verification limits.
