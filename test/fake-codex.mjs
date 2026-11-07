// A fake `codex` CLI for tests (CHEAPAG_CODEX_BIN points here). It speaks `codex exec --json`'s JSONL as seen on
// codex-cli 0.167.0 (docs/codex-worker.md). CHEAPAG_FAKE_CODEX names a folder holding script.json, an array with one
// list of actions per run (run n = the nth process started), and log.jsonl, where each run appends
// { pid, argv, cwd, prompt } before acting.
//
// Actions: { write, content } edits a file in the working root; { cmd } one shell command item; { tools: n } n command
// items; { text } an agent message; { report } an agent message ending in a cheapag-result block; { sleep } ms;
// { fail } turn.failed and exit 1; { exit, stderr } exit with that code and no turn.completed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const dir = process.env.CHEAPAG_FAKE_CODEX;
const argv = process.argv.slice(2);
const root = argv.includes("-C") ? argv[argv.indexOf("-C") + 1] : process.cwd();
const resumed = argv[1] === "resume" ? argv[2] : undefined;

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", main);

const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const log = join(dir, "log.jsonl");
  const run = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
  appendFileSync(log, JSON.stringify({ pid: process.pid, argv, cwd: process.cwd(), prompt }) + "\n");
  const actions = JSON.parse(readFileSync(join(dir, "script.json"), "utf8"))[run] ?? [{ text: "no script for this run" }];
  emit({ type: "thread.started", thread_id: resumed ?? "thread-1" });
  emit({ type: "turn.started" });
  let item = 0;
  const id = () => `item_${item++}`;
  const command = (cmd) => emit({ type: "item.completed", item: { id: id(), type: "command_execution", command: cmd, aggregated_output: "", exit_code: 0, status: "completed" } });
  for (const a of actions) {
    if (a.write !== undefined) {
      const file = isAbsolute(a.write) ? a.write : join(root, a.write);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, a.content);
      emit({ type: "item.completed", item: { id: id(), type: "file_change", changes: [{ path: file, kind: "add" }], status: "completed" } });
    } else if (a.cmd !== undefined) command(a.cmd);
    else if (a.tools !== undefined) for (let i = 0; i < a.tools; i++) command(`echo ${i}`);
    else if (a.text !== undefined) emit({ type: "item.completed", item: { id: id(), type: "agent_message", text: a.text } });
    else if (a.report !== undefined) {
      const r = a.report;
      const block = ["```cheapag-result", `summary: ${r.summary}`, "risks:", ...(r.risks ?? []).map((x) => `- ${x}`), "review:", ...(r.review ?? []).map((x) => `- ${x}`), "missing:", ...(r.missing ?? []).map((x) => `- ${x}`), "```"].join("\n");
      emit({ type: "item.completed", item: { id: id(), type: "agent_message", text: `Done.\n\n${block}` } });
    } else if (a.sleep !== undefined) await sleep(a.sleep);
    else if (a.fail !== undefined) {
      emit({ type: "error", message: a.fail });
      emit({ type: "turn.failed", error: { message: a.fail } });
      process.exit(1);
    } else if (a.exit !== undefined) {
      if (a.stderr) process.stderr.write(a.stderr + "\n");
      process.exit(a.exit);
    }
  }
  emit({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 5 } });
}
