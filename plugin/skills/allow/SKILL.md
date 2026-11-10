---
name: allow
description: Opt this repository in to sending code to Cheap Agent's worker models - all models, --zdr-only (zero-retention only), or --models provider/model,...; --codex also allows Codex CLI workers (code goes to OpenAI)
argument-hint: "[--zdr-only | --models provider/model,... | --codex] [--provider-wide]"
disable-model-invocation: true
allowed-tools: Bash(npx -y cheap-agent@1.3.2 allow) Bash(npx -y cheap-agent@1.3.2 allow *)
---

!`npx -y cheap-agent@1.3.2 allow $ARGUMENTS`

The developer ran this consent command themselves; its output is above. Report it in one line.

For OpenRouter, `--provider-wide` explicitly approves current and future models, including new upstream recipients after updates. It can be combined with `--zdr-only`, but not `--models` or `--codex`. Without it, the existing route-scoped behavior remains. Provider-wide consent does not authorize another provider or Codex workers.

Only because the user invoked this skill: If no output appears above (Codex): run that command yourself once, exactly as written, with `$ARGUMENTS` replaced by whatever the user typed after the skill name (or nothing). Do not run `cheapag allow` again or change consent in any other way.

Use this skill only when explicitly requested by the user for the current task. Installation and repository consent never authorize automatic invocation.
