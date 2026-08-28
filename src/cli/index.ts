/**
 * WireParity - Developer CLI & Flag Handling (Step 9.3)
 *
 * Implements the command-line interface:
 *   - Parses flags: --spec, --ts, --py, --go, --seed, --replay-path,
 *                   --iterations, --bail, --operations, --json, --help, --version
 *   - Instantiates SubprocessSDKRunners
 *   - Executes the differential testing orchestrator
 *   - Emits human-readable terminal reports or machine-readable JSON
 *   - Returns standard exit codes (0 = pass, 1 = divergence, 2 = config error)
 */

import { parseArgs } from "node:util";
import fs from "node:fs";
import { parseOpenAPISpec } from "../openapi/index.js";
import { formatTerminalReport } from "../reporter/terminal.js";
import { formatJsonReport } from "../reporter/json.js";
import { runParitySuite } from "../reporter/orchestrator.js";
import { SubprocessSDKRunner } from "../runners/subprocess.js";
import type { SDKRunner } from "../runners/types.js";

// ─── CLI Options Interface ────────────────────────────────────────────────────

export interface CliOptions {
  spec?: string;
  ts?: string;
  py?: string;
  go?: string;
  seed?: string;
  replayPath?: string;
  iterations?: number;
  bail?: boolean;
  operations?: string[];
  json?: boolean;
  help?: boolean;
  version?: boolean;
}

// ─── CLI Argument Parser ──────────────────────────────────────────────────────

export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      spec: { type: "string", short: "s" },
      ts: { type: "string" },
      py: { type: "string" },
      go: { type: "string" },
      seed: { type: "string" },
      "replay-path": { type: "string" },
      iterations: { type: "string", short: "n" },
      bail: { type: "boolean", short: "b" },
      operations: { type: "string", short: "o" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
  });

  const iterations = values.iterations ? parseInt(values.iterations, 10) : undefined;
  if (values.iterations && (isNaN(iterations!) || iterations! <= 0)) {
    throw new Error(`Invalid --iterations value: "${values.iterations}". Must be a positive integer.`);
  }

  const operations = values.operations
    ? values.operations.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  return {
    spec: values.spec,
    ts: values.ts,
    py: values.py,
    go: values.go,
    seed: values.seed,
    replayPath: values["replay-path"],
    iterations,
    bail: values.bail ?? false,
    operations,
    json: values.json ?? false,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

// ─── Subprocess Command Helper ────────────────────────────────────────────────

function buildRunner(language: "typescript" | "python" | "go", rawCommand: string): SubprocessSDKRunner {
  const tokens = rawCommand.trim().split(/\s+/);
  const command = tokens[0]!;
  const args = tokens.slice(1);
  return new SubprocessSDKRunner(language, { command, args });
}

// ─── Main CLI Runner ──────────────────────────────────────────────────────────

export async function runCLI(argv: string[] = process.argv.slice(2)): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (err: unknown) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  if (options.help) {
    console.log(`WireParity - Differential Testing Tool for Multi-Language SDKs

Usage:
  wireparity --spec <path-to-openapi> [options]

Options:
  -s, --spec <path>         Path to OpenAPI 3.0/3.1 spec JSON/YAML (required)
  --ts <command>            TypeScript runner command or entrypoint
  --py <command>            Python runner command or entrypoint
  --go <command>            Go runner command or entrypoint
  --seed <string|number>    Deterministic seed for property testing
  --replay-path <path>      Deterministic tree path for single-shot reproduction
  -n, --iterations <num>    Number of test iterations per operation (default: 5)
  -b, --bail                Stop test execution on first divergent operation
  -o, --operations <list>   Comma-separated list of operation IDs to test
  --json                    Output machine-readable JSON report
  -h, --help                Show this help message
  -v, --version             Show version
`);
    return 0;
  }

  if (options.version) {
    console.log("wireparity v0.1.0");
    return 0;
  }

  if (!options.spec) {
    console.error("Error: Missing required argument --spec <path>");
    return 2;
  }

  if (!fs.existsSync(options.spec)) {
    console.error(`Error: Specification file not found at "${options.spec}"`);
    return 2;
  }

  let doc;
  try {
    const specContent = fs.readFileSync(options.spec, "utf-8");
    const rawSpec = JSON.parse(specContent);
    doc = parseOpenAPISpec(rawSpec);
  } catch (err: unknown) {
    console.error(`Error parsing OpenAPI specification: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const runners: SDKRunner[] = [];
  if (options.ts) {
    runners.push(buildRunner("typescript", options.ts));
  }
  if (options.py) {
    runners.push(buildRunner("python", options.py));
  }
  if (options.go) {
    runners.push(buildRunner("go", options.go));
  }

  if (runners.length === 0) {
    console.error("Error: At least one runner must be specified (--ts, --py, or --go)");
    return 2;
  }

  // Validate operation filter if specified
  if (options.operations && options.operations.length > 0) {
    const availableOpIds = new Set(doc.operations.map((o) => o.id));
    const unknownOps = options.operations.filter((id) => !availableOpIds.has(id));
    if (unknownOps.length > 0) {
      console.error(`Error: Unknown operation ID(s) specified in --operations: ${unknownOps.join(", ")}`);
      return 2;
    }
  }

  try {
    const report = await runParitySuite(doc, runners, {
      seed: options.seed,
      replayPath: options.replayPath,
      iterationsPerOperation: options.iterations,
      bail: options.bail,
      operations: options.operations,
    });

    if (options.json) {
      console.log(formatJsonReport(report));
    } else {
      console.log(formatTerminalReport(report));
    }

    return report.divergentOperations > 0 ? 1 : 0;
  } catch (err: unknown) {
    console.error(`Error during suite execution: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
