import { resolve } from "node:path";
import { projectRoot } from "./workspace.js";

/** Resolve relative CLI targets from the invocation directory, never search adjacent repos. */
export function repoTarget(args: string[], cwd = process.cwd()): { args: string[]; root: string } {
  const rest = [...args];
  const at = rest.indexOf("--repo");
  let target = cwd;
  if (at !== -1) {
    if (!rest[at + 1] || rest[at + 1].startsWith("--")) throw new Error("--repo requires a path");
    target = resolve(cwd, rest[at + 1]);
    rest.splice(at, 2);
    if (rest.includes("--repo")) throw new Error("--repo may be specified only once");
  }
  return { args: rest, root: target };
}

export function repoArgs(args: string[], cwd = process.cwd()) {
  const parsed = repoTarget(args, cwd);
  return { ...parsed, root: projectRoot(parsed.root) };
}
