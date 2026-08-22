import { parseArgs } from "node:util";
import fs from "node:fs";
import { parseOpenAPISpec } from "../openapi/index.js";
import { formatTerminalReport } from "../reporter/terminal.js";
import { runParitySuite } from "../reporter/orchestrator.js";
import { SubprocessSDKRunner } from "../runners/subprocess.js";
import type { SDKRunner } from "../runners/types.js";

export async function runCLI(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      spec: { type: "string", short: "s" },
      ts: { type: "string" },
      py: { type: "string" },
      go: { type: "string" },
      seed: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`WireParity - Differential Testing Tool for Multi-Language SDKs

Usage:
  wireparity --spec <path-to-openapi> [options]

Options:
  -s, --spec <path>    Path to OpenAPI 3.0/3.1 spec JSON/YAML
  --ts <command>       TypeScript runner command or entrypoint
  --py <command>       Python runner command or entrypoint
  --go <command>       Go runner command or entrypoint
  --seed <string>      Deterministic seed for property testing
  -h, --help           Show this help message
  -v, --version        Show version
`);
    return 0;
  }

  if (values.version) {
    console.log("wireparity v0.1.0");
    return 0;
  }

  if (!values.spec) {
    console.error("Error: Missing required argument --spec <path>");
    return 2;
  }

  const specContent = fs.readFileSync(values.spec, "utf-8");
  const rawSpec = JSON.parse(specContent);
  const doc = parseOpenAPISpec(rawSpec);

  const runners: SDKRunner[] = [];
  if (values.ts) {
    runners.push(new SubprocessSDKRunner("typescript", { command: values.ts }));
  }
  if (values.py) {
    runners.push(new SubprocessSDKRunner("python", { command: values.py }));
  }
  if (values.go) {
    runners.push(new SubprocessSDKRunner("go", { command: values.go }));
  }

  if (runners.length === 0) {
    console.error("Error: At least one runner must be specified (--ts, --py, or --go)");
    return 2;
  }

  const report = await runParitySuite(doc, runners, { seed: values.seed });
  console.log(formatTerminalReport(report));

  return report.divergentOperations > 0 ? 1 : 0;
}
