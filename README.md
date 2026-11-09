<h1 align="center">Cheap Agent</h1>

<p align="center">
  <em>Your frontier model is a principal engineer. Stop paying it to type.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/cheap-agent?style=flat-square&color=111111&label=npm" alt="npm">
  <img src="https://img.shields.io/badge/for-Claude%20Code%20%7C%20Codex-111111?style=flat-square" alt="For Claude Code and Codex">
  <img src="https://img.shields.io/badge/cheap%20model-%C2%BD%C2%A2%20a%20task-111111?style=flat-square" alt="Cheap model: half a cent a task">
  <img src="https://img.shields.io/badge/tested%20on-SWE--bench%20Verified-111111?style=flat-square" alt="Tested on SWE-bench Verified">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <img src="assets/demo.gif" width="880" alt="Two real Claude Code sessions side by side, same prompt: Claude Code alone climbs to 233k Opus tokens, Claude Code with Cheap Agent stops at 132k, and the cheap model costs $0.007.">
</p>

<p align="center">
  <img src="assets/hero.svg" width="880" alt="Same feature, same prompt: Claude Code alone used 154k Opus tokens in 5 turns; with Cheap Agent 57k Opus tokens in 2 turns, 63% fewer, and the cheap model cost half a cent. Both versions pass all their tests.">
</p>

<p align="center">
  <strong>Same feature. Same prompt. 63% fewer Opus tokens.</strong><br>
  <strong>Your Claude or ChatGPT plan lasts longer. Your code still ships with tests.</strong>
</p>

<p align="center">
  ⭐ Star it, and click <strong>Watch → Custom → Releases</strong> to hear when new versions ship.
  <br>💬 Questions, ideas and setups: <a href="https://www.reddit.com/r/CheapAgent/">r/CheapAgent</a>
</p>

## Install

Works in Claude Code and Codex. One login covers both.

### Claude Code

**Easiest:** paste this into Claude Code. It asks what you want, then gives you one command to run.

```text
Set up Cheap Agent (npm: cheap-agent) for me.
1. Ask me: which provider (OpenRouter recommended, DeepSeek, OpenCode Go, Command Code or OpenCode Zen), and which
   models (balanced is the default; cheapest, strongest, or my own provider/model).
2. Check that node is 20+ and the claude CLI is installed.
3. If I picked my own model, save {"models":{"implement":"<model>"}} in
   ~/.config/cheapag/config.json, keeping what else is there.
4. Give me the command to run in my terminal: npx cheap-agent login --preset <my choice,
   or custom>, and which provider to pick with the arrow keys or its number (1 OpenCode Go, 2 OpenRouter,
   3 DeepSeek, 4 Command Code, 5 OpenCode Zen, 6 Custom endpoint). I run it and type my API key there. Never ask for my key.
5. When I say done, check `claude mcp list` shows cheapag, then tell me to run
   /cheapag:allow in a new Claude Code session in my project.
```

**Or do it yourself:**

```bash
npx cheap-agent
```

Pick a provider (**OpenRouter** if unsure), press Enter for the recommended models, paste your API key. It checks the key works, then adds itself to Claude Code for every project.

Then, in each project, once:

```
/cheapag:allow
```

**Explicit requests only.** Ask Claude to use Cheap Agent for the current task when you want delegation.

### Codex

Log in (say no when it offers to add itself to Claude Code, if you don't use Claude):

```bash
npx cheap-agent
```

Add the plugin:

```bash
codex plugin marketplace add muaaz9329/cheap-ag
```

```bash
codex plugin add cheapag@cheap-agent
```

Start `codex` in your project and trust the 3 cheapag hooks when it asks. Then, in each project, once:

```
$cheapag:allow
```

**Explicit requests only.** Ask Codex to use Cheap Agent for the current task when you want delegation.

**You need:**
- [Claude Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex)
- [Node.js](https://nodejs.org) 20+
- An API key with a few dollars on it from [OpenRouter](https://openrouter.ai/keys), [DeepSeek](https://platform.deepseek.com), [OpenCode Go](https://opencode.ai), [OpenCode Zen](https://opencode.ai/zen) (pay-as-you-go) or [Command Code](https://commandcode.ai) (Command Code needs a plan with API access; OpenCode Go needs Regions set to Global in its console for the DeepSeek models). Or any OpenAI-compatible endpoint, including a model on your own machine with no key at all: [custom endpoint](#use-any-openai-compatible-endpoint).

A few dollars lasts hundreds of tasks. It runs on macOS, Linux and Windows.

**Windows:** you also need [Git for Windows](https://git-scm.com/downloads/win) (Git Bash). Known so far:
- The very first job can take about 2 minutes while the cheap model's engine (OpenCode) sets itself up. Later jobs start in seconds.
- If that engine crashes mid-session, Cheap Agent starts a new one, but the crashed copy can stay running (`opencode.exe` in Task Manager) until you end it or restart.
- The cheap model can't read your dependency folders (like `node_modules`) inside its copy of the project. Your tests still run normally.

---

You know the principal engineer. Twenty years in. Sees the whole system at once. Costs a fortune per hour.

You would never pay them to type out a CSV exporter.

But that's exactly what happens every time your frontier model (Claude Opus, GPT-6 Astra or Sol) writes your code: the most expensive model you have, reading files, typing boilerplate, re-running tests, burning through your plan.

**Cheap Agent fixes the org chart.** Your frontier model plans and decides. A model that costs half a cent per task does the typing, in its own copy of your project, and has to prove its work with a test before anything reaches you.

## Why I built this

The idea: get **$200-plan usage out of the $100 Claude plan**, and **$50–70 worth out of the $20 plan**, with a few dollars of DeepSeek doing the typing.

I've met a lot of students, mostly in developing countries, who really want Opus for the hard problems and simply can't afford $100 a month. I wanted to find something that helps them.

This is a small effort from my side. It won't make Opus ten times cheaper. But stretching the plan you already pay for is something, and something is better than nothing.

📖 The full story (why I built it, how it works step by step, and the SWE-bench numbers): **[Cheap Agent: how I made my Claude plan last 2.2–2.7x longer](https://muaazkhan.me/blog/cheap-agent)**

## The numbers

Tested on [SWE-bench Verified](https://www.swebench.com): real bugs from real open-source projects, graded by the official harness. Same prompts in Claude Code with Opus 5.5, with and without Cheap Agent.

<p align="center">
  <img src="assets/chart.svg" width="880" alt="Opus tokens, Claude Code alone versus with Cheap Agent. Adding a feature: 154k vs 57k, 63% less, both pass all tests. 7 everyday bug fixes: 1.6M vs 655k, 59% less, 7 of 7 solved by both. 9 of the hardest bugs: 3.0M vs 1.3M, 55% less, 6 of 9 solved vs 7 of 9, with a Sonnet helper doing the leftovers.">
</p>

**What I won't hide:**
- On the very hardest bugs it solved 6 of 9 where plain Opus solved 7 (on a single run plain Opus averages about 6 too).
- On tiny jobs (a few lines, or a whole small app from nothing), Opus is already quick, so there's nothing to save.

Cheap Agent shines on the work in between: real features and real fixes in real code. That's most of your day.

## Before / after

**The ask:** *"Add monthly budgets to the expense tracker, plus a CSV export. Tests for everything."*

|  | Claude Code alone | Claude Code + Cheap Agent |
|---|---|---|
| Opus tokens | 154k | **57k** |
| Opus turns | 5 | **2** |
| Who wrote the code | Opus | a cheap model, for **$0.005** |
| Tests | 33 passing | **38 passing** |

Opus wrote one task. The cheap model did the rest, tests included.

## Built with itself

Native Windows support (36 files, +753/−278 lines) was built with Cheap Agent. Claude found the problems and wrote the plans. The cheap model wrote the code in 30 jobs for **$0.29 in total**, Sonnet helpers finished what it couldn't and read OpenCode's source to find the two Windows-only bugs, and the full test suite now passes on Linux and Windows.

## How it works

<p align="center">
  <img src="assets/flow.svg" width="880" alt="How it works: Opus writes a short task; a cheap model works in its own copy of your project and adds a fix and test; Cheap Agent runs the checks and verifies the reproduction against the original code. Work that passes its checks lands uncommitted, with a risk note if reproduction could not be verified. If the cheap model cannot finish, your agent asks how to continue.">
</p>

- **Every change is checked.** Cheap Agent runs the checks itself. For a bug fix, it also tests the reproduction against the original code without touching your stash, and preserves the fix with a risk note when reproduction cannot be verified.
- **Your project stays clean.** Work happens in a private copy (a git worktree). Only work that passes its checks lands; a reproduction the server could not verify lands with a risk note. It lands uncommitted, so you review the diff like any other.
- **Your frontier model stays in charge.** Cheap Agent's hooks stop it from quietly redoing work that already passed. By default, a failed step asks you how to continue; automatic takeover is an optional setting.

## Commands

| Claude Code | Codex | What it does |
|---|---|---|
| `/cheapag:allow` | `$cheapag:allow` | Your OK to send this project's code to the cheap model. Once per project. |
| `/cheapag:status` | `$cheapag:status` | Recent jobs, and what the cheap model has cost you. |
| `/cheapag:hook on` | `$cheapag:hook on` | No more "I'll just do it myself": your frontier model *must* hand code changes to the cheap model. |
| `/cheapag:clean` | `$cheapag:clean` | Tidy up old job folders. |
| `/cheapag:model` | `$cheapag:model` | Pick the worker's main and fallback models, each with an effort. |
| `/cheapag:provider` | `$cheapag:provider` | Switch to another provider you've already logged in to, with no key prompt. This project's consent moves with it, and you see what it now covers. If the new provider fails its check, nothing changes. Add a new provider with `npx cheap-agent login`. |

While a job runs, Claude Code shows the worker's latest step under the tool call, and Codex shows it each time it checks in (about every 15 seconds). To follow every step in a second terminal, run `npx cheap-agent watch`.

## Settings

Optional. Put a `cheapag.json` in a project:

| Setting | Default | What it does |
|---|---|---|
| `takeover` | `"ask"` | What happens when the cheap model couldn't finish a step. `"ask"`: Claude asks you first, so nothing is spent without your choice. `"sonnet"`: a Sonnet helper takes over automatically, often several hundred thousand Claude tokens on a hard task. `"self"`: Claude does it, capped at 15 tool calls (`limits.takeover_calls`). Claude Code only; Codex asks in chat (`"ask"`) or finishes it itself. |
| `limits.max_turns` | `25` | The most turns the cheap model gets per step. |
| `models` | from setup | Which cheap models to use. Switch with `npx cheap-agent login --preset strongest`. |
| `aliases` | none | Short names for `model` (below), e.g. `{"glm": "openrouter/z-ai/glm-5.3", "flash": "openrouter/deepseek/deepseek-v4.1-flash"}`. |
| `retention` | `{ "unlanded_worktree_days": 2, "job_log_days": 7 }` | Days cleanup keeps an unlanded worktree and a job's log folder. It runs at server start and every hour for each prepared root. |

Use `npx cheap-agent model` to save main and fallback models with their effort settings. A named login preset follows that preset's choices in later releases; explicit `models` settings override it. Completed event logs are compressed. Cleanup leaves active jobs alone, and a folder-removal error after landing is reported without changing a successful result.

### Picking the model for one task

Ask for it ("use GLM for this"), and your agent passes `model` on `delegate` or `research`: a `provider/model` name or one of your `aliases`. That model runs the task alone, with no fallbacks, so a rate limit ends it as BUDGET instead of moving to another model. The stronger escalation model still takes a step the first model couldn't. The model has to be on the provider you're logged in with and allowed by the project's consent. Without `model`, the settings above decide.

An explicit call model wins over saved models, presets and difficulty tiers, and remains selected for batch repair jobs. Provider and model changes preserve aliases and the separate Codex opt-in. Model-specific provider consent cannot transfer to another provider; a failed provider check restores the previous settings and consent.

### Running a task on Codex instead

With the [Codex CLI](https://github.com/openai/codex) installed and signed in, `delegate` can hand a task to Codex instead of OpenCode: pass `model: "codex/<model>"` (e.g. `codex/gpt-5.5-codex`), or `codex/default` (or just `codex`) for the model your `~/.codex/config.toml` names. An alias works too: `{"cx": "codex/default"}`.

- Code goes to OpenAI, so it needs its own opt-in: run `npx cheap-agent allow --codex` (or `/cheapag:allow --codex`) in the project. It doesn't change, or need, the consent for your Cheap Agent provider.
- Codex runs in the job's worktree with `codex exec --sandbox workspace-write`, no approvals and no network, and without your Codex config, MCP servers or hooks (so nothing else sees the code and no hook writes into the worktree). Set `CHEAPAG_CODEX_BIN` if `codex` isn't on your PATH.
- Caps, checks, self-fixes and landing work as usual. When a check still fails after the self-fixes, the task escalates by resuming the same Codex thread once at high reasoning effort (never lower than your config's). A Codex task never asks a question (it notes ambiguities under risks) and shows `cost=unknown`: a ChatGPT plan reports no price. Your plan's usage limit ends the job as BUDGET.
- Codex alone needs no `npx cheap-agent login`: without one, `codex/` tasks still run, `ping` reports `provider=none`, and every other `delegate` or `research` asks you to log in.
- Batch repairs keep the selected Codex model, including repairs started later by `land`. OpenCode provider recovery and backend retries apply only to OpenCode jobs.
- `delegate` only for now: `research` on a `codex/` model is refused. Design notes: [docs/codex-worker.md](docs/codex-worker.md).

## Orchestrators and git worktrees

Cheap Agent works in the repository your session started in. If one session runs several tasks, each in its own git worktree (an orchestrator handing tickets to subagents, say), pass `root` with the worktree's absolute path on `delegate`, `research`, `jobs`, `land` and `reply`. Jobs then run, land and keep their records in that worktree, and the session's own checkout is untouched. Each worktree needs its own consent (`/cheapag:allow` there, or a copied `.cheapag/consent.json`). Without `root`, nothing changes.

## Use any OpenAI-compatible endpoint

The worker can run on any OpenAI-compatible API: your own server (llama.cpp's `llama-server`, Strata, Ollama, LM Studio, vLLM), a gateway (LiteLLM, Azure), or a vendor's API. Run `npx cheap-agent login` and pick **Custom endpoint**. It asks for:

- **The URL**, e.g. `http://127.0.0.1:8080/v1` (llama.cpp), `http://127.0.0.1:11434/v1` (Ollama), or a gateway's `https://…/v1`. A bare host gets `/v1` added when that is where the API answers. Plain `http` only works for this machine or a private network; anything else needs `https`.
- **The API key**, only if the endpoint checks one. Give the name of an environment variable that holds it (e.g. `MY_GATEWAY_KEY`, set where Claude Code starts), or the path to a file that holds just the key. OpenCode reads it; Cheap Agent never does, and the key never lands in a config.
- **The model**, picked from the endpoint's own list.
- **The context window** a single request gets. It's detected from llama.cpp (split across its parallel slots) and LM Studio. Set it, so OpenCode can compact a long job before the endpoint rejects it.
- **Prices**, optional: input/output in USD per million tokens (e.g. `0.27/1.10`). Without usable pricing, cost is unknown and the dollar cap is incomplete; time and turn caps still apply.

It's saved as `local` in `~/.config/cheapag/config.json`, and only there: a repo's `cheapag.json` can't point the worker at another endpoint. While it's set, it's used even if you're also logged in to a hosted provider. Logging in to a hosted provider removes it.

```json
{ "local": { "base_url": "https://gateway.example.com/v1", "model": "deepseek-v4.1-flash", "api_key_env": "MY_GATEWAY_KEY", "context": 131072, "price": { "input": 0.27, "output": 1.1 } } }
```

`"api_key_file": "/home/me/.config/llama.key"` takes the key from a file instead of `api_key_env`. `"output"` sets the most tokens per reply, when `"context"` is set (default: a quarter of the context, at most 32k). There are no fallbacks and no stronger model to escalate to, unless `models.escalation` names one on the same server (`"local/<id>"`, e.g. a second model behind LiteLLM). `models.medium` and `models.hard` work the same way.

Things to know:
- **The model has to be good at tool calls.** The worker reads, edits, runs tests and must call `finish`. Small models often can't. A model that does well on agentic coding benchmarks is the minimum.
- **A local server is slower.** Raise `limits.max_minutes` (default 20) if jobs time out. With one slot on the server, set `limits.max_parallel` to `1` so batch steps don't queue behind each other.
- **Consent still applies.** `/cheapag:allow` shows the endpoint URL, and asks again if the URL changes. A gateway may forward code to another provider; that's up to its config and terms.

## FAQ

**Is a half-cent model actually any good?**
On its own, no. With a written task from your frontier model, a test it has to pass, and a referee that runs that test, yes, most of the time. When it isn't, it says so and a stronger model takes over.

**Does my frontier model check the work?**
The tests check the work, and Cheap Agent runs them. Opus checking every passing change cost three times the tokens and caught nothing in my runs, so it trusts a pass. You still review the diff before you commit.

**Where does my code go?**
To the provider you picked, only after you run `/cheapag:allow` (`$cheapag:allow` in Codex) in that project, which also shows exactly which models will see it. Your API key stays on your machine, in a hidden prompt and a local credential store, never in chat.

**Will it commit or push anything?**
Never. Changes land uncommitted. Your git, your call.

**Why not just use Sonnet for everything?**
Sonnet still costs real usage on every line it types. The cheap model types for half a cent. Sonnet only gets called when the cheap model is stuck.

**A worker was denied a command its permissions allow. How do I see why?**
Set `CHEAPAG_DEBUG=1` in the server's environment and restart it. The bundled OpenCode then runs with its own debug logging, written to one file per server under `~/.config/cheapag/logs/` (`ping` shows the path). Your saved keys, the server password and anything that looks like a credential are masked. Off by default.

**Can I use it at work, or build on it?**
Yes. It's MIT licensed: use it, change it, share it, at any company, for free ([MIT License](./LICENSE)).

**Why "Cheap Agent"?**
Because your plan isn't.

## Contributing

PRs are welcome, and I'm more than happy to merge them. Setup, where things live, and how to add a provider are in [CONTRIBUTING.md](./CONTRIBUTING.md). For ideas and questions, come say hi on [r/CheapAgent](https://www.reddit.com/r/CheapAgent/).

## Update or remove

New versions are announced on the [Releases page](https://github.com/muaaz9329/cheap-ag/releases). Startup is quiet. Set `CHEAPAG_UPDATE_CHECK=1` to opt into upstream version checks; fork users should review fork release notes before updating.

**Update:**

```bash
npx cheap-agent@latest
```

In Codex, also:

```bash
codex plugin marketplace upgrade
```

**Remove** (two commands):

```bash
claude plugin uninstall cheapag@cheapag
```

```bash
claude mcp remove -s user cheapag
```

In Codex:

```bash
codex plugin remove cheapag@cheap-agent
```

## Fork integration behavior

Installation, connection, and repository/provider consent are technical prerequisites, never permission to delegate. Every skill (including status and plan-writing) requires explicit invocation. There is no persistent task authorization switch. MCP cannot independently verify conversational intent; the host must enforce this policy.

Use `--repo <path>` with `allow`, `hook`, `status`, `clean`, and `watch` when targeting another repository. Relative paths resolve from the invocation directory. Outside a repository, supply a target; job IDs never trigger sibling searches. MCP `root` remains absolute. Guards require a matching session and prompt after a delegation result in that repository; absent prompt IDs disable enforcement.

Custom endpoint consent is now bound to a SHA-256 fingerprint of the canonical URL. Existing local-provider consent must be renewed with `cheapag allow --repo <path>`; changing the destination requires renewal even with the same model. Scheme, host, default port and trailing slash equivalents share an identity; meaningful paths remain distinct. Credentials, queries and fragments in URLs are rejected; key-file and environment references remain supported. Independent Codex consent and aliases are preserved.

`delegate` accepts optional `kind: fix|change|feature`. A step kind wins over call kind, then inference applies. `feature` aliases `change`; any fix in a group enables fix checks. Integration repairs remain fixes.

Research records separate reproduction command, claimed outcome and execution verification. Verified means an exact command was observed completing, not that its output interpretation was proven. Quoted and argument whitespace is significant. Denied or unmatched claims are unverified. Snapshots may omit ignored or unlinked files; historical handoffs are context only. Older records remain readable.

Usage retains numeric `costUsd` with optional `costSource` (`reported`, `configured`, `unknown`, `mixed`) and `costIncomplete`. Configured prices are estimates; unknown pricing is never displayed as free. Mixed totals show their known subtotal and incomplete coverage; legacy amounts remain readable. Dollar caps enforce known amounts, while time and turn caps always apply.

Run `cheapag doctor [--client codex|claude|both] [--repo <path>]` for a read-only installation report (default: both clients, current directory). It checks runtime/launcher paths, generated manifests, configuration references, enablement, duplicates and explicit trust entries. Disabled-by-choice is normal. Malformed configuration or broken referenced installations return failure. It performs no repairs, provider calls or host startup, and does not display credential values. Inspected layers are reported individually: effective host configuration and connectivity are not asserted. See [Codex configuration layers](https://developers.openai.com/codex/config-basic/) and [skill invocation metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata).

Landing rehashes affected tracked files in a disposable index before its three-way check. This protects against stale stat entries and assume-unchanged flags, preserving the real index, stash and concurrent contents. It does not eliminate edits racing after the landing check. See [fork provenance](docs/fork-provenance.md).
