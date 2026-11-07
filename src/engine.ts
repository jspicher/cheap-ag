import { openCodexSession } from "./codex.js";
import type { Opencode } from "./opencode.js";
import type { WorkerModel } from "./routing.js";
import { openSession, releaseDirectory, type Session } from "./worker.js";

/** Engine dispatch: a job's worker is OpenCode, or the Codex CLI for a `codex/` model (docs/codex-worker.md). */

export const isCodex = (m: WorkerModel) => m.providerID === "codex";

/** Opens the job's worker session on the engine its model runs on; OpenCode needs its booted server, Codex does not. */
export async function openWorker(opts: Omit<Parameters<typeof openSession>[0], "opencode"> & { opencode?: Opencode }): Promise<Session> {
  if (isCodex(opts.model)) return openCodexSession(opts);
  if (!opts.opencode) throw new Error("no OpenCode server for an OpenCode worker");
  return openSession({ ...opts, opencode: opts.opencode });
}

/** Lets go of a worktree before it is removed: OpenCode disposes its instance there; Codex holds nothing once its process ended. */
export async function releaseWorker(directory: string, model: WorkerModel) {
  if (!isCodex(model)) await releaseDirectory(directory);
}
