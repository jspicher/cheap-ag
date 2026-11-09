import { expect, onTestFinished, test } from "vitest";
import { startFakeOpencode } from "./fake-opencode.js";
import { tempRepo } from "./harness.js";
import { runSession } from "../src/worker.js";
import { messageCost, renderCost, sumCosts } from "../src/usage.js";
import { runtimeError } from "../src/runtime-error.js";
test("unknown, known zero, configured estimates, mixed totals and legacy values stay distinct", () => {
  const unknown = messageCost("local", 0, 100, 100);
  expect(renderCost(unknown)).toBe("cost=unknown");
  expect(messageCost("local", 0, 100, 100, { input: 0, output: 0 })).toEqual({ costUsd: 0, costSource: "configured" });
  const known = messageCost("local", 0, 1e6, 1e6, { input: 1, output: 2 });
  expect(known.costUsd).toBe(3);
  expect(sumCosts([known, unknown])).toEqual({ costUsd: 3, costSource: "mixed", costIncomplete: true });
  expect(renderCost(sumCosts([known, unknown]))).toContain("known-subtotal,incomplete");
  expect(renderCost({ costUsd: 1 })).toBe("cost=$1.000");
  expect(messageCost("local", undefined, 0, 0)).toEqual(unknown);
  expect(messageCost("codex", 0, 0, 0)).toEqual(unknown);
  expect(messageCost("openrouter", 0, 0, 0)).toEqual(unknown);
  expect(messageCost("openrouter", 0, 0, 0, undefined, true)).toEqual({ costUsd: 0, costSource: "reported" });
});
test("missing token fields and missing cost do not break a worker session", async () => {
  const repo = tempRepo(); onTestFinished(repo.cleanup);
  const fake = await startFakeOpencode(); onTestFinished(fake.close);
  fake.script({ missingTokens: true }, { text: "done" });
  const result = await runSession({ opencode: { url: fake.url, password: "fake", version: "test" }, directory: repo.dir, model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" }, onEvent: () => {}, prompt: "q" });
  expect(result.error).toBeUndefined(); expect(result.text).toBe("done");
  expect(result.usage.inputTokens).toBe(0);
});
test("runtime diagnostics only expose safe codes and HTTP statuses from causes", () => {
  const result = runtimeError({ name: "APIError", data: { message: "request failed", cause: { code: "ECONNREFUSED", status: 503, headers: { authorization: "SECRET" }, body: "SECRET", url: "https://SECRET" } } });
  expect(result).toContain("ECONNREFUSED"); expect(result).toContain("503"); expect(result).not.toContain("SECRET");
});
