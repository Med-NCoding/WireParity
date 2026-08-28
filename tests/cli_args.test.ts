/**
 * WireParity - Step 9.3: CLI Arguments Parser & Flag Handling Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, runCLI } from "../src/cli/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PETSTORE_PATH = resolve(ROOT, "fixtures/specs/petstore.json");
const TS_RUNNER = `node ${resolve(ROOT, "fixtures/runners/ts_runner.ts")}`;
const PY_RUNNER = `python3 ${resolve(ROOT, "fixtures/runners/py_runner.py")}`;
const GO_RUNNER = `node ${resolve(ROOT, "fixtures/runners/go_runner.ts")}`;

describe("CLI Argument Parser & Flag Handling (Step 9.3)", () => {
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

  describe("parseCliArgs", () => {
    it("parses all CLI flags into structured options", () => {
      const argv = [
        "--spec",
        "api.json",
        "--ts",
        "node ts_runner.js",
        "--py",
        "python3 py_runner.py",
        "--go",
        "go run main.go",
        "--seed",
        "custom-seed",
        "--replay-path",
        "0:1:0:2",
        "--iterations",
        "15",
        "--bail",
        "--operations",
        "listPets,createPet",
        "--json",
      ];

      const opts = parseCliArgs(argv);
      expect(opts.spec).toBe("api.json");
      expect(opts.ts).toBe("node ts_runner.js");
      expect(opts.py).toBe("python3 py_runner.py");
      expect(opts.go).toBe("go run main.go");
      expect(opts.seed).toBe("custom-seed");
      expect(opts.replayPath).toBe("0:1:0:2");
      expect(opts.iterations).toBe(15);
      expect(opts.bail).toBe(true);
      expect(opts.operations).toEqual(["listPets", "createPet"]);
      expect(opts.json).toBe(true);
    });

    it("parses short flags correctly", () => {
      const argv = ["-s", "spec.json", "-n", "3", "-b", "-o", "getPet", "-h", "-v"];
      const opts = parseCliArgs(argv);

      expect(opts.spec).toBe("spec.json");
      expect(opts.iterations).toBe(3);
      expect(opts.bail).toBe(true);
      expect(opts.operations).toEqual(["getPet"]);
      expect(opts.help).toBe(true);
      expect(opts.version).toBe(true);
    });

    it("throws error for invalid iterations argument", () => {
      expect(() => parseCliArgs(["--iterations", "abc"])).toThrow(
        'Invalid --iterations value: "abc"'
      );
      expect(() => parseCliArgs(["--iterations", "0"])).toThrow(
        'Invalid --iterations value: "0"'
      );
      expect(() => parseCliArgs(["--iterations=-5"])).toThrow(
        'Invalid --iterations value: "-5"'
      );
    });

  });

  describe("runCLI Execution & Exit Codes", () => {
    it("returns exit code 0 for --help", async () => {
      const code = await runCLI(["--help"]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("--spec"));
    });

    it("returns exit code 0 for --version", async () => {
      const code = await runCLI(["--version"]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith("wireparity v0.1.0");
    });

    it("returns exit code 2 when missing --spec argument", async () => {
      const code = await runCLI(["--ts", "node runner.js"]);
      expect(code).toBe(2);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Missing required argument --spec"));
    });

    it("returns exit code 2 when spec file does not exist", async () => {
      const code = await runCLI(["--spec", "/non/existent/path/spec.json", "--ts", "node runner.js"]);
      expect(code).toBe(2);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Specification file not found"));
    });

    it("returns exit code 2 when no SDK runners are specified", async () => {
      const code = await runCLI(["--spec", PETSTORE_PATH]);
      expect(code).toBe(2);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("At least one runner must be specified"));
    });

    it("returns exit code 2 when unknown operation is specified in --operations", async () => {
      const code = await runCLI([
        "--spec",
        PETSTORE_PATH,
        "--ts",
        TS_RUNNER,
        "--operations",
        "nonExistentOperation",
      ]);
      expect(code).toBe(2);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown operation ID(s) specified in --operations: nonExistentOperation")
      );
    });

    it("executes targeted operation test with exit code 0 when parity passes", async () => {
      const code = await runCLI([
        "--spec",
        PETSTORE_PATH,
        "--ts",
        TS_RUNNER,
        "--py",
        PY_RUNNER,
        "--go",
        GO_RUNNER,
        "--operations",
        "createPet",
        "--iterations",
        "2",
        "--seed",
        "cli-test-seed",
      ]);

      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[PASS] Operation: createPet"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Status: SUCCESS (100% wire parity)"));
    });

    it("outputs machine-readable JSON when --json flag is passed", async () => {
      const code = await runCLI([
        "--spec",
        PETSTORE_PATH,
        "--ts",
        TS_RUNNER,
        "--py",
        PY_RUNNER,
        "--operations",
        "deletePet",
        "--iterations",
        "2",
        "--json",
      ]);

      expect(code).toBe(0);
      const jsonCalls = logSpy.mock.calls.map((c) => c[0]);
      const jsonOutput = jsonCalls.find((c) => typeof c === "string" && c.includes('"schemaVersion"'));
      expect(jsonOutput).toBeDefined();

      const parsed = JSON.parse(jsonOutput!);
      expect(parsed.status).toBe("passed");
      expect(parsed.operations).toHaveLength(1);
      expect(parsed.operations[0].operationId).toBe("deletePet");
    });
  });
});
