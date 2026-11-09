import { afterEach, expect, test, vi } from "vitest";
const { rm } = vi.hoisted(() => ({ rm: vi.fn() }));
vi.mock("node:fs", async importOriginal => ({ ...await importOriginal<typeof import("node:fs")>(), rmSync: rm }));
import { removeDirectory } from "../src/platform.js";
afterEach(() => { vi.restoreAllMocks(); rm.mockReset(); });

test("transient removal errors retry at most ten times and still report the final error", () => {
  const error = Object.assign(new Error("held directory"), { code: "EPERM" });
  rm.mockImplementation(() => { throw error; });
  const sleep = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
  expect(() => removeDirectory("owned-directory")).toThrow(error);
  expect(rm).toHaveBeenCalledTimes(11);
  expect(sleep.mock.calls.reduce((sum, args) => sum + Number(args[3]), 0)).toBe(11000);
});

test("non-transient permission failures are not swallowed or retried", () => {
  const error = Object.assign(new Error("ACL denied"), { code: "EACCES" });
  rm.mockImplementation(() => { throw error; });
  const sleep = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
  expect(() => removeDirectory("owned-directory")).toThrow(error);
  expect(rm).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});
