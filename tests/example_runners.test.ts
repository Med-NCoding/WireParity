/**
 * WireParity - Tests for External User Example Runners & Config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCLI } from "../src/cli/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const EXAMPLE_CONFIG = resolve(ROOT, "examples/wireparity.config.json");
const EXAMPLE_SPEC = resolve(ROOT, "examples/spec.yaml");
const TS_RUNNER = `node ${resolve(ROOT, "examples/runners/typescript/runner.ts")}`;
const PY_RUNNER = `python3 ${resolve(ROOT, "examples/runners/python/runner.py")}`;

describe("Example Runners & Config", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("runs differential testing successfully with examples/wireparity.config.json", async () => {
    const code = await runCLI(["--config", EXAMPLE_CONFIG]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Status: SUCCESS (100% wire parity)")
    );
  });

  it("runs differential testing via CLI flags using example spec and runners", async () => {
    const code = await runCLI([
      "--spec",
      EXAMPLE_SPEC,
      "--ts",
      TS_RUNNER,
      "--py",
      PY_RUNNER,
      "--iterations",
      "2",
    ]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Status: SUCCESS (100% wire parity)")
    );
  });
});
