import { fileURLToPath } from "node:url";

/** A copyable command for this build, independent of cwd, PATH shims and upstream npm.
 * Source imports and compiled imports both resolve to the package's built entry point.
 * Windows hints target PowerShell; POSIX hints use standard shell quoting.
 */
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url)).replaceAll("\\", "/");
const quoted = process.platform === "win32" ? `'${entry.replaceAll("'", "''")}'` : `'${entry.replaceAll("'", `'\\''`)}'`;
export const CLI = `node ${quoted}`;
