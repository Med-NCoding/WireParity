/**
 * WireParity - JSON Configuration File Loader (Step 9.4)
 *
 * Provides strictly validated JSON configuration file loading from
 * `wireparity.config.json` or custom path via `--config <path>`.
 *
 * Features:
 *   - Auto-discovery of `wireparity.config.json` in working directory
 *   - Strict schema validation with descriptive error messages
 *   - Relative path resolution anchored to config file directory
 *   - Clean precedence merging: CLI flags > config file options
 */

import fs from "node:fs";
import path from "node:path";
import type { CliOptions } from "./index.js";

// ─── Configuration File Interfaces ────────────────────────────────────────────

export interface WireParityRunnersConfig {
  typescript?: string;
  python?: string;
  go?: string;
}

export interface WireParityOptionsConfig {
  seed?: string | number;
  replayPath?: string;
  iterations?: number;
  bail?: boolean;
  operations?: string[];
  json?: boolean;
}

export interface WireParityConfig {
  spec: string;
  runners: WireParityRunnersConfig;
  options?: WireParityOptionsConfig;
}

export const CONFIG_FILE_NAME = "wireparity.config.json";

// ─── Discovery & Loading ──────────────────────────────────────────────────────

/**
 * Searches for `wireparity.config.json` starting from `startDir`.
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break; // Reached root directory
    }
    currentDir = parent;
  }
  return null;
}

/**
 * Validates and loads a JSON configuration file.
 * Resolves relative spec paths against the config file directory.
 */
export function loadConfigFile(configPath: string): WireParityConfig {
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: "${resolvedPath}"`);
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (err: unknown) {
    throw new Error(`Failed to read configuration file: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: unknown) {
    throw new Error(`Invalid JSON in configuration file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`);
  }

  return validateAndNormalizeConfig(parsed, path.dirname(resolvedPath));
}

/**
 * Validates the parsed JSON object against the WireParityConfig schema.
 */
export function validateAndNormalizeConfig(raw: unknown, baseDir: string = process.cwd()): WireParityConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Configuration file must contain a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  // 1. Validate spec
  if (typeof obj.spec !== "string" || obj.spec.trim().length === 0) {
    throw new Error("Configuration error: 'spec' must be a non-empty string path to an OpenAPI spec");
  }
  const specPath = path.isAbsolute(obj.spec) ? obj.spec : path.resolve(baseDir, obj.spec);

  // 2. Validate runners
  if (!obj.runners || typeof obj.runners !== "object" || Array.isArray(obj.runners)) {
    throw new Error("Configuration error: 'runners' must be an object containing runner commands");
  }

  const runnersObj = obj.runners as Record<string, unknown>;
  const ts = typeof runnersObj.typescript === "string" ? runnersObj.typescript.trim() : undefined;
  const py = typeof runnersObj.python === "string" ? runnersObj.python.trim() : undefined;
  const go = typeof runnersObj.go === "string" ? runnersObj.go.trim() : undefined;

  if (!ts && !py && !go) {
    throw new Error("Configuration error: 'runners' must declare at least one of 'typescript', 'python', or 'go'");
  }

  // 3. Validate options (optional)
  let optionsConfig: WireParityOptionsConfig | undefined;
  if (obj.options !== undefined) {
    if (!obj.options || typeof obj.options !== "object" || Array.isArray(obj.options)) {
      throw new Error("Configuration error: 'options' must be an object");
    }

    const opt = obj.options as Record<string, unknown>;

    let iterations: number | undefined;
    if (opt.iterations !== undefined) {
      if (typeof opt.iterations !== "number" || isNaN(opt.iterations) || opt.iterations <= 0) {
        throw new Error("Configuration error: 'options.iterations' must be a positive integer");
      }
      iterations = opt.iterations;
    }

    let operations: string[] | undefined;
    if (opt.operations !== undefined) {
      if (!Array.isArray(opt.operations) || !opt.operations.every((o) => typeof o === "string")) {
        throw new Error("Configuration error: 'options.operations' must be an array of operation ID strings");
      }
      operations = opt.operations;
    }

    let seed: string | number | undefined;
    if (opt.seed !== undefined) {
      if (typeof opt.seed !== "string" && typeof opt.seed !== "number") {
        throw new Error("Configuration error: 'options.seed' must be a string or number");
      }
      seed = opt.seed;
    }

    optionsConfig = {
      seed,
      replayPath: typeof opt.replayPath === "string" ? opt.replayPath : undefined,
      iterations,
      bail: typeof opt.bail === "boolean" ? opt.bail : undefined,
      operations,
      json: typeof opt.json === "boolean" ? opt.json : undefined,
    };
  }

  return {
    spec: specPath,
    runners: {
      typescript: ts,
      python: py,
      go,
    },
    options: optionsConfig,
  };
}

/**
 * Merges loaded configuration file options with explicit CLI flags.
 * CLI flags take precedence over config file options.
 */
export function mergeConfigWithCli(
  config: WireParityConfig,
  cliOpts: CliOptions
): CliOptions {
  return {
    spec: cliOpts.spec ?? config.spec,
    ts: cliOpts.ts ?? config.runners.typescript,
    py: cliOpts.py ?? config.runners.python,
    go: cliOpts.go ?? config.runners.go,
    seed: cliOpts.seed ?? (config.options?.seed !== undefined ? String(config.options.seed) : undefined),
    replayPath: cliOpts.replayPath ?? config.options?.replayPath,
    iterations: cliOpts.iterations ?? config.options?.iterations,
    bail: cliOpts.bail || (config.options?.bail ?? false),
    operations: cliOpts.operations ?? config.options?.operations,
    json: cliOpts.json || (config.options?.json ?? false),
    help: cliOpts.help,
    version: cliOpts.version,
    config: cliOpts.config,
  };
}
