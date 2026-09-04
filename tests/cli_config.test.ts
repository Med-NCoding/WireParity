/**
 * WireParity - Step 9.4: JSON Configuration File Loader Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateAndNormalizeConfig,
  loadConfigFile,
  mergeConfigWithCli,
  type WireParityConfig,
} from "../src/cli/config.js";
import { runCLI } from "../src/cli/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PETSTORE_PATH = resolve(ROOT, "fixtures/specs/petstore.json");
const TS_RUNNER = `node ${resolve(ROOT, "fixtures/runners/ts_runner.ts")}`;
const PY_RUNNER = `python3 ${resolve(ROOT, "fixtures/runners/py_runner.py")}`;

describe("JSON Configuration File Loader (Step 9.4)", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wireparity-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  describe("validateAndNormalizeConfig", () => {
    it("validates and normalizes complete valid config object", () => {
      const raw = {
        spec: "specs/api.json",
        runners: {
          typescript: "node ts.js",
          python: "python3 py.py",
          go: "go run main.go",
        },
        options: {
          seed: 4242,
          replayPath: "0:1",
          iterations: 10,
          bail: true,
          operations: ["listPets", "createPet"],
          json: true,
        },
      };

      const config = validateAndNormalizeConfig(raw, "/workspace");
      expect(config.spec).toBe(path.resolve("/workspace", "specs/api.json"));
      expect(config.runners.typescript).toBe("node ts.js");
      expect(config.runners.python).toBe("python3 py.py");
      expect(config.runners.go).toBe("go run main.go");
      expect(config.options).toEqual({
        seed: 4242,
        replayPath: "0:1",
        iterations: 10,
        bail: true,
        operations: ["listPets", "createPet"],
        json: true,
      });
    });

    it("throws error for non-object config", () => {
      expect(() => validateAndNormalizeConfig("string")).toThrow(
        "must contain a JSON object"
      );
      expect(() => validateAndNormalizeConfig(null)).toThrow(
        "must contain a JSON object"
      );
      expect(() => validateAndNormalizeConfig([])).toThrow(
        "must contain a JSON object"
      );
    });

    it("throws error for missing or empty spec path", () => {
      expect(() => validateAndNormalizeConfig({ runners: { typescript: "node ts.js" } })).toThrow(
        "'spec' must be a non-empty string"
      );
      expect(() => validateAndNormalizeConfig({ spec: "   ", runners: { typescript: "node ts.js" } })).toThrow(
        "'spec' must be a non-empty string"
      );
    });

    it("throws error for missing or empty runners", () => {
      expect(() => validateAndNormalizeConfig({ spec: "api.json" })).toThrow(
        "'runners' must be an object"
      );
      expect(() => validateAndNormalizeConfig({ spec: "api.json", runners: {} })).toThrow(
        "must declare at least one of 'typescript', 'python', or 'go'"
      );
    });

    it("throws error for invalid option properties", () => {
      expect(() =>
        validateAndNormalizeConfig({
          spec: "api.json",
          runners: { typescript: "node ts.js" },
          options: { iterations: -5 },
        })
      ).toThrow("'options.iterations' must be a positive integer");

      expect(() =>
        validateAndNormalizeConfig({
          spec: "api.json",
          runners: { typescript: "node ts.js" },
          options: { operations: ["listPets", 123] },
        })
      ).toThrow("'options.operations' must be an array of operation ID strings");
    });
  });

  describe("loadConfigFile", () => {
    it("loads and parses valid configuration JSON file", () => {
      const configPath = path.join(tmpDir, "wireparity.config.json");
      const configData = {
        spec: PETSTORE_PATH,
        runners: {
          typescript: TS_RUNNER,
          python: PY_RUNNER,
        },
        options: {
          iterations: 3,
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), "utf-8");

      const loaded = loadConfigFile(configPath);
      expect(loaded.spec).toBe(PETSTORE_PATH);
      expect(loaded.runners.typescript).toBe(TS_RUNNER);
      expect(loaded.runners.python).toBe(PY_RUNNER);
      expect(loaded.options?.iterations).toBe(3);
    });

    it("throws error if config file does not exist", () => {
      expect(() => loadConfigFile(path.join(tmpDir, "missing.json"))).toThrow(
        "Configuration file not found"
      );
    });

    it("throws error on invalid JSON syntax in config file", () => {
      const configPath = path.join(tmpDir, "bad.json");
      fs.writeFileSync(configPath, "{ not valid json", "utf-8");

      expect(() => loadConfigFile(configPath)).toThrow("Invalid JSON in configuration file");
    });
  });

  describe("mergeConfigWithCli", () => {
    it("overrides config options with explicit CLI flags", () => {
      const config: WireParityConfig = {
        spec: "/path/to/spec1.json",
        runners: {
          typescript: "node runner1.js",
          python: "python3 runner1.py",
        },
        options: {
          iterations: 5,
          bail: false,
          seed: "config-seed",
        },
      };

      const cli = {
        spec: "/path/to/override.json",
        iterations: 20,
        bail: true,
      };

      const merged = mergeConfigWithCli(config, cli);
      expect(merged.spec).toBe("/path/to/override.json");
      expect(merged.iterations).toBe(20);
      expect(merged.bail).toBe(true);
      expect(merged.ts).toBe("node runner1.js");
      expect(merged.py).toBe("python3 runner1.py");
      expect(merged.seed).toBe("config-seed");
    });
  });

  describe("runCLI Integration with Config File", () => {
    it("executes differential test suite using --config flag", async () => {
      const configPath = path.join(tmpDir, "wireparity.config.json");
      const configData = {
        spec: PETSTORE_PATH,
        runners: {
          typescript: TS_RUNNER,
          python: PY_RUNNER,
        },
        options: {
          operations: ["deletePet"],
          iterations: 2,
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), "utf-8");

      const exitCode = await runCLI(["--config", configPath]);
      expect(exitCode).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[PASS] Operation: deletePet"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Status: SUCCESS (100% wire parity)"));
    });

    it("executes differential test suite using --config flag pointing to a YAML spec", async () => {
      const configPath = path.join(tmpDir, "wireparity.config.json");
      const yamlSpecPath = resolve(ROOT, "fixtures/specs/petstore.yaml");
      const configData = {
        spec: yamlSpecPath,
        runners: {
          typescript: TS_RUNNER,
          python: PY_RUNNER,
        },
        options: {
          operations: ["deletePet"],
          iterations: 2,
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), "utf-8");

      const exitCode = await runCLI(["--config", configPath]);
      expect(exitCode).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[PASS] Operation: deletePet"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Status: SUCCESS (100% wire parity)"));
    });

    it("returns exit code 2 when config file cannot be loaded", async () => {
      const exitCode = await runCLI(["--config", "/non/existent/config.json"]);
      expect(exitCode).toBe(2);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Error loading configuration file"));
    });
  });
});
