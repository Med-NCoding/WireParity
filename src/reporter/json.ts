/**
 * WireParity - Machine-Readable JSON Report Output (Step 9.2)
 *
 * Provides a structured JSON report serializer for CI/CD automation,
 * tooling integrations, and persistent test artifact generation.
 *
 * Serializes:
 *   - Global suite metadata (timestamp, title, seed, status)
 *   - High-level pass/fail summary metrics
 *   - Granular per-operation results with categorized divergences
 *   - Reproducer metadata (seed, path, replay tokens, CLI replay commands)
 *   - Minimized counterexample input payloads
 */

import type { DiffSeverity, SemanticDiff } from "../comparator/types.js";
import type { ParityReport, ParityReportItem } from "./terminal.js";

// ─── Machine-Readable JSON Schema Interfaces ──────────────────────────────────

export interface JsonReportDivergence {
  category: string;
  severity: DiffSeverity;

  location: "path" | "query" | "headers" | "body" | "method";
  path: string;
  message: string;
  sdkA: string;
  sdkB: string;
  expected: unknown;
  actual: unknown;
}

export interface JsonReportReplay {
  seed: number | string;
  path?: string;
  token?: string;
  cliCommand?: string;
}

export interface JsonReportOperation {
  operationId: string;
  status: "passed" | "failed" | "error";
  hasDivergence: boolean;
  executionError?: string;
  durationMs: number;
  divergences: JsonReportDivergence[];
  replay?: JsonReportReplay;
  minimizedReproducer?: Record<string, unknown>;
  shrinkingSteps?: number;
}

export interface JsonReportSummary {
  totalOperations: number;
  passedOperations: number;
  divergentOperations: number;
  executionErrorOperations?: number;
  durationMs: number;
  passRate: number;
}

export interface StructuredJsonReport {
  version: "1.0.0";
  schemaVersion: "1.0.0";
  timestamp: string;
  status: "passed" | "failed";
  spec: {
    title: string;
  };
  seed: string | number;
  summary: JsonReportSummary;
  operations: JsonReportOperation[];
}

export interface JsonReporterOptions {
  /** Pretty-print with 2-space indentation (default: true) */
  pretty?: boolean;
  /** Custom timestamp ISO string (defaults to current time) */
  timestamp?: string;
}

// ─── Builder & Formatter ──────────────────────────────────────────────────────

/**
 * Builds the structured JSON report object from a ParityReport.
 */
export function buildJsonReportObject(
  report: ParityReport,
  options: JsonReporterOptions = {}
): StructuredJsonReport {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const totalDuration = report.results.reduce((sum, item) => sum + item.durationMs, 0);
  const errorCount = report.executionErrorOperations ?? report.results.filter((r) => !!r.executionError).length;
  const isOverallFailed = report.divergentOperations > 0 || errorCount > 0;
  const status: "passed" | "failed" = isOverallFailed ? "failed" : "passed";
  const passRate =
    report.totalOperations > 0
      ? Number((report.passedOperations / report.totalOperations).toFixed(4))
      : 1.0;

  const operations: JsonReportOperation[] = report.results.map((item) => {
    let opStatus: "passed" | "failed" | "error";
    if (item.executionError) {
      opStatus = "error";
    } else if (item.hasDivergence) {
      opStatus = "failed";
    } else {
      opStatus = "passed";
    }

    const divergences: JsonReportDivergence[] = (item.executionError ? [] : item.diffs).map((diff) => ({
      category: diff.category,
      severity: diff.severity ?? "critical",
      location: diff.location,
      path: diff.path,
      message: diff.message,
      sdkA: diff.sdkA,
      sdkB: diff.sdkB,
      expected: diff.expected,
      actual: diff.actual,
    }));

    let replay: JsonReportReplay | undefined;
    if (!item.executionError && (item.seed !== undefined || item.path || item.replayToken)) {
      const seedVal = item.seed ?? report.seed;
      replay = {
        seed: seedVal,
        path: item.path,
        token: item.replayToken ?? (item.path ? `${seedVal}:${item.path}` : undefined),
        cliCommand:
          item.path !== undefined
            ? `wireparity --seed ${seedVal} --replay-path ${item.path} --operations ${item.operationId}`
            : undefined,
      };
    }

    return {
      operationId: item.operationId,
      status: opStatus,
      hasDivergence: !item.executionError && item.hasDivergence,
      durationMs: item.durationMs,
      divergences,
      replay,
      minimizedReproducer: item.executionError ? undefined : item.minimizedReproducer,
      shrinkingSteps: item.executionError ? undefined : item.shrinkingSteps,
      ...(item.executionError ? { executionError: item.executionError } : {}),
    };
  });

  return {
    version: "1.0.0",
    schemaVersion: "1.0.0",
    timestamp,
    status,
    spec: {
      title: report.title,
    },
    seed: report.seed,
    summary: {
      totalOperations: report.totalOperations,
      passedOperations: report.passedOperations,
      divergentOperations: report.divergentOperations,
      executionErrorOperations: errorCount,
      durationMs: totalDuration,
      passRate,
    },
    operations,
  };
}

/**
 * Formats a ParityReport as a serialized JSON string.
 */
export function formatJsonReport(
  report: ParityReport,
  options: JsonReporterOptions = {}
): string {
  const obj = buildJsonReportObject(report, options);
  const pretty = options.pretty ?? true;
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
}

/**
 * Parses and validates a JSON report string.
 */
export function parseJsonReport(jsonString: string): StructuredJsonReport {
  const parsed = JSON.parse(jsonString) as StructuredJsonReport;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON report: payload must be a JSON object");
  }
  if (parsed.version !== "1.0.0") {
    throw new Error(`Unsupported JSON report version: ${parsed.version}`);
  }
  if (!parsed.summary || typeof parsed.summary !== "object") {
    throw new Error("Invalid JSON report: missing 'summary' block");
  }
  if (!Array.isArray(parsed.operations)) {
    throw new Error("Invalid JSON report: 'operations' must be an array");
  }
  return parsed;
}
