# Selected fork adaptations

Version remains `1.3.2-js.1`. These are focused adaptations, not wholesale merges. Our Codex engine, per-call model overrides, generated launcher, multi-root isolation and cleanup behavior remain the base.

| Area | Donor evidence | Adaptation |
| --- | --- | --- |
| Quiet startup | [vladgabrielboca 7a57337](https://github.com/vladgabrielboca/cheap-ag/commit/7a57337f880875e2fc69059a1aaa72c7440c72ce) | Quiet for both hosts; explicit invocation metadata and prompt-scoped guards |
| Repository targeting | [yuvrajbajwa10 4432e19](https://github.com/yuvrajbajwa10/cheap-ag/commit/4432e19b2808488305f28af0aa81c95684b93258) | Explicit CLI targets and per-file guards; no sibling discovery or cross-root job lookup |
| Git diagnostics | [Zzmes f8d5f04](https://github.com/Zzmes/cheap-ag/commit/f8d5f047b205689dedad10e47b6e44d2003c2311) | Typed failure categories without dumping potentially sensitive Git stderr |
| Endpoint consent | [jeanlorencini 3be2ae7](https://github.com/jeanlorencini/cheap-ag-custom-endpoints/commit/3be2ae7300a52408febe91955c45cbc9af0081e8) | Fingerprint existing local-provider destination; no new provider or credential store |
| Landing | [Ongyouki 4df0601](https://github.com/Ongyouki/cheap-ag-codex/commit/4df06014aafc23f08a3bfba50837cf2f56d6540c) | Rehash affected contents in the disposable index before the three-way check |
| Research and diagnostics | [jeanlorencini 9decca0](https://github.com/jeanlorencini/cheap-ag-custom-endpoints/commit/9decca085ee4d51abbff6d4352266d9bd6179c16) | Exact completed-command matching preserving argument whitespace; resource finalization and safe diagnostics |
| Installation inspection | [Ongyouki f10ae59](https://github.com/Ongyouki/cheap-ag-codex/commit/f10ae597e8c595b0b909324e7b8bd9ecce37bc96) | Read-only doctor for both clients, our launcher and plugin layout, TOML parsing and explicitly bounded configuration claims |

Task-kind precedence and cost provenance extend these adaptations without changing existing deadline or reproduction mechanics. `feature` aliases `change`; explicit model selections remain attached to deferred repairs. Older result records remain readable.

Antigravity, BigModel, Z.ai Coding Plan, Cheaper Inference and cheapaimodel integrations remain deferred. This integration does not publish a package, reinstall the active plugin, or perform paid provider tests. Rollback uses revert commits.

## Live-test follow-ups

The November 8 Claude smoke test exposed two independent issues addressed locally in this fork:

- OpenCode's global RTK plugin rewrote allowed `git diff` calls to `rtk git diff` before permission evaluation. `OPENCODE_CONFIG_DIR` adds a config layer rather than excluding global config. Worker startup now isolates XDG config and home-level config discovery and clears inherited explicit config selectors, while retaining the shared credential data store and endpoint key environment. See OpenCode 1.19.0's [configuration paths](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/opencode/src/config/paths.ts). A fake-provider regression uses a real OpenCode server and deliberately conflicting global plugins.
- Windows directory handles caused `EPERM` during final removal. A real child-process cwd reproduced Node's native `rmSync` returning immediately despite `maxRetries`. Worktree finalization and retention cleanup now retry transient removal errors explicitly, bounded to eleven seconds of waiting. Persistent errors remain visible; there is no forced handle closure or process termination. Regression tests exercise real Windows locks, retry exhaustion, and non-transient errors.

The main README now describes this fork and its seven explicitly invoked skills instead of presenting upstream installation and marketing as fork behavior.
