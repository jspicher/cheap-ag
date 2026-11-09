import { expect, onTestFinished, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeOpencode } from "./fake-opencode.js";
import { tempRepo, startServer, callText } from "./harness.js";
import { effectiveKind } from "../src/jobs.js";
import { parsePlan } from "../src/plan.js";
test("step intent beats call intent, which beats inference; feature aliases change", () => {
  const step = (kind?: string): import("../src/plan.js").PlanStep => ({ id: "1", title: "fix crash", text: "", fields: kind ? { kind } : {} });
  expect(effectiveKind(step())).toBe("fix");
  expect(effectiveKind(step(), "change")).toBe("change");
  expect(effectiveKind(step("fix"), "feature")).toBe("fix");
  expect(effectiveKind(step("feature"), "fix")).toBe("change");
  const plan = parsePlan("# intent\n## 1 feature\nfiles: a\nkind: feature\ndone-when: exists\n## 2 fix\nfiles: b\nkind: fix\ndone-when: works");
  expect(plan.steps.map(s => effectiveKind(s, "change"))).toEqual(["change", "fix"]);
});
test("call intent reaches worker prompts and persisted job records", async () => {
  const repo = tempRepo(); onTestFinished(repo.cleanup);
  const fake = await startFakeOpencode(); onTestFinished(fake.close);
  fake.script({ edit: "note.txt", content: "new feature" }, { finish: { summary: "done", risks: [], review: [], missing: [] } });
  const server = await startServer({ cwd: repo.dir, env: { CHEAPAG_OPENCODE_URL: fake.url }, logins: { "opencode-go": "fake" }, allow: [] }); onTestFinished(server.close);
  const result = await callText(server.client, "delegate", { task: "fix wording for a feature", kind: "feature" });
  const id = result.match(/^OK (j\w+)/)![1];
  expect(JSON.parse(readFileSync(join(repo.dir, ".cheapag/jobs", id, "request.json"), "utf8"))).toMatchObject({ kind: "feature", effectiveKinds: ["change"] });
  expect(JSON.stringify(fake.recorded.prompts)).toContain("kind: change");
});
