import { afterAll, beforeAll, expect, test } from "vitest";
import { createRequire } from "node:module";
import { callText, startServer } from "./harness.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

test("server identifies itself as cheapag", () => {
  expect(server.client.getServerVersion()).toMatchObject({ name: "cheapag", version });
});

test("server instructions carry the usage rules, within Claude Code's 4,096-character cut", () => {
  const instructions = server.client.getInstructions()!;
  expect(instructions.length).toBeLessThanOrEqual(4096);
  expect(instructions.length / 4).toBeLessThanOrEqual(560); // ≈ tokens; 26's difficulty hint and 28's source and test-reading rules included
  expect(instructions).toContain("explicitly requests Cheap Agent for the current task");
  expect(instructions).not.toContain("Send every code change");
  expect(instructions).not.toContain("seconds=15");
});

test("codex host gets Codex instructions, no Claude-only rules, same server name", async () => {
  const codex = await startServer({ args: ["codex"] });
  try {
    expect(codex.client.getServerVersion()).toMatchObject({ name: "cheapag", version });
    const instructions = codex.client.getInstructions()!;
    expect(instructions).toContain("npx cheap-agent allow");
    expect(instructions).toContain("ask the user in chat");
    expect(instructions).toContain("seconds=15");
    expect(instructions).toContain("explicitly requests");
    expect(instructions).not.toContain("model: sonnet");
    expect(instructions).not.toContain("/cheapag:allow");
    expect(instructions.length).toBeLessThanOrEqual(4096);
  } finally {
    await codex.close();
  }
});

test("delegate and research load upfront in Claude Code, with descriptions that lead with what they do", async () => {
  const { tools } = await server.client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ["delegate", "research"]) expect(byName[name]._meta?.["anthropic/alwaysLoad"]).toBeUndefined();
  expect(byName.delegate.description).toMatch(/^Only after an explicit user request/);
  expect(byName.research.description).toMatch(/^Only after an explicit user request/);
  for (const t of tools.filter((t) => !["delegate", "research"].includes(t.name))) expect(t._meta?.["anthropic/alwaysLoad"]).toBeUndefined();
});

test("ping with no worker credentials is up, says provider=none and how to log in, and boots no OpenCode", async () => {
  expect(await callText(server.client, "ping")).toMatch(
    /^OK cheapag \S+ provider=none; run npx cheap-agent login for OpenCode workers$/,
  );
});

test("every tool honours the MCP contract: name <= 64 chars, flat object input schema", async () => {
  const { tools } = await server.client.listTools();
  expect(tools.map((t) => t.name)).toContain("ping");
  for (const tool of tools) {
    expect(tool.name.length).toBeLessThanOrEqual(64);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema).not.toHaveProperty("anyOf");
    expect(tool.inputSchema).not.toHaveProperty("oneOf");
    expect(tool.inputSchema).not.toHaveProperty("allOf");
    for (const prop of Object.values(tool.inputSchema.properties ?? {}) as { type?: string }[]) {
      expect(["object", "array"]).not.toContain(prop.type);
    }
  }
});
