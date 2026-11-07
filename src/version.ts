import { createRequire } from "node:module";

/** This build's version, as ping and status report it; a fork build carries a `-js.N` suffix (e.g. 1.3.2-js.1). */
export const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * The published npm version a build is based on: `version` without a fork's `-js.N` suffix. Every npx/npm package
 * reference uses it, since a fork version does not exist on npm; the update check compares on it too.
 */
export const baseVersion = (v: string) => v.replace(/-js\.\d+$/, "");
