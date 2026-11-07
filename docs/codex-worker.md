# Codex worker engine

A second worker engine next to OpenCode: the OpenAI Codex CLI (`codex exec`), picked per call with `model`.

## Selecting it

- `delegate(model: "codex/<model>")`, e.g. `codex/gpt-5.5-codex`. `codex/default` or plain `codex` runs the model the user's
  `~/.codex/config.toml` names (top-level `model`, plus `model_reasoning_effort`), or Codex's built-in default when it names none.
- A config alias may point at a codex name: `"aliases": { "cx": "codex/default" }`.
- `delegate` resolves the name before anything else. A codex name skips the OpenCode consent gate, `chooseModel`,
  `ensureOpencode` and `holdOpencode`: nothing goes to the OpenCode provider and OpenCode is never booted.
- The job's route is the codex model alone: no fallbacks, no tier models. Self-fixes still run (same thread, see below).
- Escalation: when a check still fails after the two self-fixes (or after a turn-cap stop), the job resumes the same
  thread once more with `-c model_reasoning_effort="high"`, on the same model. The route's escalation model is that
  model with `options.effort: "high"` (`codexEscalation` in `src/codex.ts`), so the job layer runs it like OpenCode's:
  `esc=1` in the headline, `esc: <summary> → passed|same failure|…` under `tried:`, `models.escalated: true`, and
  `models.final` is the same `codex/<model>`. The effort is a floor, never a downgrade: for `codex/default` whose
  config.toml already says `high` or `xhigh`, the escalation resumes at that effort (so it is one more attempt in the
  same thread at the same effort); an explicit `codex/<model>` runs at Codex's built-in default effort until it escalates.
- `research` with a codex name FAILs with a clear reason: v1 is delegate-only (see Out of scope).

## Consent

Code goes to OpenAI, a different recipient from the OpenCode provider, so it needs its own opt-in.

- `consent.json` gains an optional `engines: { codex: { approvedAt } }`. Only `cheapag allow --codex` writes it (the
  plugin's `/cheapag:allow --codex` passes the flag through). It merges into the existing record; a plain `cheapag allow`
  keeps an existing `engines` entry. Records without `engines` stay valid: they just do not allow Codex.
- `allow --codex` does not need an OpenCode provider consent, and does not grant one. A file holding only `engines`
  reads as "no OpenCode consent" (the base record's validation is unchanged).
- A codex model without the entry gets a CONSENT block: code from this repo → OpenAI via the Codex CLI (your ChatGPT
  plan or API key); retention: per your OpenAI account's data controls; approve: `npx cheap-agent allow --codex`.
- Revoking: delete the `engines` key (or `.cheapag/consent.json`). No `--no-codex` flag in v1.

## Without an OpenCode login

Codex needs no OpenCode provider, so the server runs without one:

- `delegate` with a `codex/` model runs as usual (given `allow --codex`); any other `delegate`, and every `research`,
  answers `FAIL reason: no worker provider; run npx cheap-agent login`.
- `ping` answers `OK cheapag <version> provider=none[ codex=allowed][ root=…]; run npx cheap-agent login for OpenCode
  workers` and boots no OpenCode.
- `jobs`, `reply` and `land` need no login: they act on jobs already started. Landing a batch's last group whose
  integration check fails starts its fix job on the OpenCode route, which then fails with `no worker provider for a fix
  job`.
- A Codex job's record says `provider: "codex"` (also when an OpenCode provider is logged in): its code went to OpenAI.
- `cheapag status` already prints `provider=none (run npx cheap-agent login)` and the `codex:` line.

## Running a job: Session on `codex exec`

`src/codex.ts` exports `openCodexSession`, which returns the same `{ sessionID, run, totals }` shape as
`openSession`. `src/engine.ts` picks the engine from the model (`providerID === "codex"`), so `runGroup` has one call
site and one release call (OpenCode's `releaseDirectory` is skipped for Codex).

Binary: `CHEAPAG_CODEX_BIN`, else `codex` on PATH. An npm `.cmd` shim on Windows is resolved to its
`node_modules/@openai/codex/bin/codex.js` and run with `node` (no shell, so no quoting issues); a `.js`/`.mjs` path also
runs with `node` (the test fake). Missing binary: the run ends with `error: Codex CLI not found (…); install it with npm i
-g @openai/codex or set CHEAPAG_CODEX_BIN`, which the job reports as `FAIL reason: worker error: …`.

First prompt:

```
codex exec --json --ignore-user-config --disable hooks --disable plugins --disable apps --disable memories
  -c approval_policy="never" -s workspace-write -C <worktree> [-m <model>] [-c model_reasoning_effort=…] -
```

Follow-ups (self-fix after a failed check, redo, findings note):

```
codex exec resume <thread_id> --json --ignore-user-config --disable hooks … -c approval_policy="never"
  -c sandbox_mode="workspace-write" [-m <model>] -
```

(`resume` takes no `-s`/`-C`, so the sandbox goes through `-c` and the process runs with cwd = worktree.)

- The prompt goes on stdin (`-`): no Windows command-line limit, no quoting.
- `--ignore-user-config`: seen live, the user's config loads ~40 MCP servers (code could flow to Tavily, Exa…), and the
  user's hooks (graft) wrote `graft/`, `.gitignore` and `.ignore` into the probe repo, which would land with the diff.
  `--disable hooks` covers hooks.json. Auth still comes from `CODEX_HOME`. The global `~/.codex/AGENTS.md` still loads.
- Windows: with the user config ignored, `-s workspace-write` silently runs read-only (seen live in the smoke run:
  the worker reported "the session is read-only"). Every run on Windows passes `-c windows.sandbox="<mode>"`, the
  user's `[windows] sandbox` from config.toml, else `unelevated`.
- Sandbox `workspace-write` keeps writes inside the worktree (linked `node_modules` junctions point outside it, so
  they stay read-only) and has no network. Approval `never`: a command the sandbox refuses fails back to the model.

### JSONL events (seen live on codex-cli 0.167.0)

```
{"type":"thread.started","thread_id":"01a1b7ec-…"}
{"type":"turn.started"}
{"type":"item.started"|"item.completed","item":{"id":"item_1","type":"command_execution","command":"…","aggregated_output":"…","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_1","type":"file_change","changes":[{"path":"C:\\…\\a.txt","kind":"update"}],"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"done"}}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `x` not found…"}}   (a warning)
{"type":"turn.completed","usage":{"input_tokens":118273,"cached_input_tokens":94848,"cache_write_input_tokens":0,"output_tokens":223,"reasoning_output_tokens":22}}
{"type":"error","message":"The 'x' model is not supported when using Codex with a ChatGPT account."}
{"type":"turn.failed","error":{"message":"…"}}   (exit code 1)
```

Mapping:

- `thread.started` → `sessionID` (a getter: it is known after the first run starts).
- Each completed tool item (`command_execution`, `file_change`, `mcp_tool_call`, `web_search`) is one turn. It is
  passed to `onEvent` as an OpenCode-shaped `message.part.updated` tool part (`bash` with `{command}`, `edit`/`write`
  with `{filePath}` relative to the worktree, …) carrying the raw item under `codex`, so the job's progress lines, turn
  cap and repro check work unchanged and `events.jsonl` keeps the raw event.
- The run's last `agent_message` is `text`; `finishReport` parses its `cheapag-result` block.
- `turn.completed.usage` accumulates: input = `input_tokens - cached_input_tokens`, cacheRead = cached, output,
  reasoning. **Cost is 0**: on a ChatGPT plan Codex reports no price, and an API-key price would be a guess. The
  turn and minute caps still apply; the cost cap never trips. `spend` records `codex/<model>: 0`, which the ledger skips.
- `turn.failed`/`error` → `error`. A message naming a usage or rate limit becomes `limit`, which the job (no fallbacks)
  reports as `BUDGET: Codex usage limit for <model>: <message>`.
- Exit without `turn.completed` → `error: codex exited with code N: <last stderr line>`.

### Prompt

Codex has no `finish` tool and no question tool. The first prompt is the worker rules (Codex wording of OpenCode's
agent prompt) then the usual context pack. The rules end with: finish by ending the last message with exactly one
fenced `cheapag-result` block (summary, risks, review, missing, repro, disagree). An ambiguity or a missing package is
written under `missing`/`risks` instead of asked: a Codex job never goes BLOCKED (`onQuestion` is never called, as for fix
jobs). Any later prompt that says "call finish" gets one line appended: report with the `cheapag-result` block instead.

### Abort and caps

`spawn` is `detached` on POSIX. The job's stop signal (turn cap, minute cap, cancel) or a run's `interrupt` kills the
process tree: `taskkill /T /F` on Windows, the process group on POSIX (`killProcessGroup`). An interrupted run returns
`interrupted: true`; a stopped one `error: aborted`. The thread stays on disk, so the findings note after a cap is one
more `resume` (bounded by its own 30 s timeout, as for OpenCode).

## Out of scope for v1

- `research` on Codex (would need a read-only sandbox run and the research block format); FAILs with a reason.
- Escalation to a second Codex model (escalation stays on the job's model, at a higher effort).
- A Codex batch's integration fix job runs on Codex when `delegate` starts it, but on the OpenCode route when `land`
  starts it (landing a batch's last group), since `land` takes no `model`.
- `cheapag status`/`ping` only show whether Codex is allowed here; they do not run `codex --version`.
