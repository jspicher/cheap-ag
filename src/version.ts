import { createRequire } from "node:module";

/** This build's version, as ping and status report it; a fork build carries a `-js.N` suffix (e.g. 1.3.2-js.1). */
export const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * The upstream version a build is based on, without its `-js.N` suffix. Used for the opt-in
 * upstream update comparison and recognizing legacy plugin templates, never to replace this fork.
 */
export const baseVersion = (v: string) => v.replace(/-js\.\d+$/, "");
