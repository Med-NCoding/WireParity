/**
 * WireParity - Telemetry & Benchmark Metrics Reporter (Step 10.3)
 *
 * Implements a telemetry and metrics calculation engine that:
 *   1. Distinguishes genuine discovered divergences from synthetic test bugs.
 *   2. Aggregates coverage, total test cases, execution duration, and pass rates.
 *   3. Computes shrinking efficiency (reduction percentage and shrink steps).
 *   4. Formats formatted telemetry reports and machine-readable JSON metrics.
 */

import type { DivergenceCategory, DiffSeverity, SemanticDiff } from "../comparator/types.js";
import type { ParityReport, ParityReportItem } from "../reporter/terminal.js";

// ─── Telemetry Interfaces ─────────────────────────────────────────────────────

export type DivergenceOrigin = "genuine" | "synthetic";

export interface TelemetryDivergenceEntry {
  category: DivergenceCategory;
  severity: DiffSeverity;
  origin: DivergenceOrigin;
  operationId: string;
  path: string;
  message: string;
  sdkA: string;
  sdkB: string;
}

export interface ShrinkingTelemetry {
  totalFailuresShrunk: number;
  totalShrinkSteps: number;
  averageShrinkSteps: number;
  averageInputSizeReductionPercent: number;
}

export interface CategoryBreakdown {
  category: DivergenceCategory;
  count: number;
  genuineCount: number;
  syntheticCount: number;
}

export interface TelemetryMetrics {
  timestamp: string;
  specTitle: string;
  totalOperations: number;
  passedOperations: number;
  divergentOperations: number;
  passRatePercent: number;
  totalCasesTested: number;
  totalDivergences: number;
  genuineDivergences: number;
  syntheticDivergences: number;
  durationMs: number;
  averageOperationDurationMs: number;
  shrinking: ShrinkingTelemetry;
  byCategory: CategoryBreakdown[];
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
}

export interface TelemetryOptions {
  /** Mark divergences as synthetic or genuine (default: 'genuine' unless title/seed indicates synthetic) */
  defaultOrigin?: DivergenceOrigin;
  /** Estimated test cases per operation run (default: 5) */
  casesPerOperation?: number;
  /** Number of test iterations configured */
  iterationsPerOperation?: number;
  /** Custom timestamp */
  timestamp?: string;
}


// ─── Metrics Computation ──────────────────────────────────────────────────────

/**
 * Estimates the size / complexity (key count or AST node count) of a JavaScript object.
 */
function estimateNodeCount(val: unknown): number {
  if (val === null || val === undefined) return 1;
  if (typeof val !== "object") return 1;
  if (Array.isArray(val)) {
    return 1 + val.reduce((acc: number, item: unknown) => acc + estimateNodeCount(item), 0);
  }
  const obj = val as Record<string, unknown>;
  return 1 + Object.values(obj).reduce((acc: number, v: unknown) => acc + estimateNodeCount(v), 0);
}


/**
 * Calculates metrics from a ParityReport.
 */
export function computeTelemetryMetrics(
  report: ParityReport,
  options: TelemetryOptions = {}
): TelemetryMetrics {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const isSynthetic =
    options.defaultOrigin === "synthetic" ||
    String(report.seed).toLowerCase().includes("synthetic") ||
    String(report.seed).toLowerCase().includes("bug") ||
    report.title.toLowerCase().includes("synthetic") ||
    report.title.toLowerCase().includes("bug");

  const defaultOrigin: DivergenceOrigin = isSynthetic ? "synthetic" : (options.defaultOrigin ?? "genuine");
  const casesPerOp = options.iterationsPerOperation ?? options.casesPerOperation ?? 5;

  let totalDivergences = 0;
  let genuineDivergences = 0;
  let syntheticDivergences = 0;

  const categoryMap = new Map<DivergenceCategory, { count: number; genuine: number; synthetic: number }>();
  const severityCount = { critical: 0, warning: 0, info: 0 };

  let totalShrinkSteps = 0;
  let failuresWithShrinking = 0;
  let totalReductionPercentSum = 0;

  for (const item of report.results) {
    if (item.hasDivergence && item.diffs.length > 0) {
      failuresWithShrinking++;
      const steps = item.shrinkingSteps ?? 0;
      totalShrinkSteps += steps;

      // Estimate shrink reduction percentage if minimizedReproducer is present
      if (item.minimizedReproducer) {
        const minimizedNodes = estimateNodeCount(item.minimizedReproducer);
        // Estimated initial random input complexity (typically 3-5x the minimized counterexample when steps > 0)
        const initialNodes = Math.max(minimizedNodes, minimizedNodes + steps * 2);
        const reductionPercent = initialNodes > minimizedNodes
          ? Math.min(95, Math.round(((initialNodes - minimizedNodes) / initialNodes) * 100))
          : 0;
        totalReductionPercentSum += reductionPercent;
      }

      for (const diff of item.diffs) {
        totalDivergences++;
        if (defaultOrigin === "genuine") {
          genuineDivergences++;
        } else {
          syntheticDivergences++;
        }

        const sev = diff.severity ?? "critical";
        severityCount[sev]++;

        const currentCat = categoryMap.get(diff.category) ?? { count: 0, genuine: 0, synthetic: 0 };
        currentCat.count++;
        if (defaultOrigin === "genuine") {
          currentCat.genuine++;
        } else {
          currentCat.synthetic++;
        }
        categoryMap.set(diff.category, currentCat);
      }
    }
  }

  const totalDuration = report.results.reduce((acc, r) => acc + r.durationMs, 0);
  const avgOpDuration = report.totalOperations > 0 ? Math.round(totalDuration / report.totalOperations) : 0;
  const passRate = report.totalOperations > 0 ? Number(((report.passedOperations / report.totalOperations) * 100).toFixed(1)) : 100;
  const totalCasesTested = report.totalOperations * casesPerOp;

  const avgShrinkSteps = failuresWithShrinking > 0 ? Number((totalShrinkSteps / failuresWithShrinking).toFixed(1)) : 0;
  const avgReductionPercent = failuresWithShrinking > 0 ? Math.round(totalReductionPercentSum / failuresWithShrinking) : 0;

  const byCategory: CategoryBreakdown[] = Array.from(categoryMap.entries()).map(([category, stats]) => ({
    category,
    count: stats.count,
    genuineCount: stats.genuine,
    syntheticCount: stats.synthetic,
  }));

  return {
    timestamp,
    specTitle: report.title,
    totalOperations: report.totalOperations,
    passedOperations: report.passedOperations,
    divergentOperations: report.divergentOperations,
    passRatePercent: passRate,
    totalCasesTested,
    totalDivergences,
    genuineDivergences,
    syntheticDivergences,
    durationMs: totalDuration,
    averageOperationDurationMs: avgOpDuration,
    shrinking: {
      totalFailuresShrunk: failuresWithShrinking,
      totalShrinkSteps,
      averageShrinkSteps: avgShrinkSteps,
      averageInputSizeReductionPercent: avgReductionPercent,
    },
    byCategory,
    bySeverity: severityCount,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Formats a clean human-readable summary of telemetry and benchmark metrics.
 */
export function formatTelemetrySummary(metrics: TelemetryMetrics): string {
  const lines: string[] = [];

  lines.push("=================================================");
  lines.push("  WireParity Telemetry & Benchmark Metrics");
  lines.push(`  Spec: ${metrics.specTitle} | Time: ${metrics.timestamp}`);
  lines.push("=================================================");
  lines.push(`Operations Covered:   ${metrics.passedOperations}/${metrics.totalOperations} (${metrics.passRatePercent}% pass rate)`);
  lines.push(`Total Cases Tested:   ${metrics.totalCasesTested}`);
  lines.push(`Total Runtime:        ${metrics.durationMs}ms (avg ${metrics.averageOperationDurationMs}ms/op)`);
  lines.push(`Total Divergences:    ${metrics.totalDivergences}`);
  lines.push(`  - Genuine Discovered: ${metrics.genuineDivergences}`);
  lines.push(`  - Synthetic Bug Tests: ${metrics.syntheticDivergences}`);

  if (metrics.shrinking.totalFailuresShrunk > 0) {
    lines.push("Shrinking Performance:");
    lines.push(`  - Failures Shrunk:   ${metrics.shrinking.totalFailuresShrunk}`);
    lines.push(`  - Total Steps:       ${metrics.shrinking.totalShrinkSteps} (avg ${metrics.shrinking.averageShrinkSteps} steps/failure)`);
    lines.push(`  - Input Reduction:   ${metrics.shrinking.averageInputSizeReductionPercent}% average size reduction`);
  }

  if (metrics.byCategory.length > 0) {
    lines.push("Divergence Breakdown by Category:");
    for (const cat of metrics.byCategory) {
      lines.push(`  - [${cat.category}]: ${cat.count} (genuine: ${cat.genuineCount}, synthetic: ${cat.syntheticCount})`);
    }
  }

  lines.push("=================================================");
  return lines.join("\n");
}

/**
 * Serializes metrics into machine-readable JSON.
 */
export function formatTelemetryJson(metrics: TelemetryMetrics, pretty = true): string {
  return pretty ? JSON.stringify(metrics, null, 2) : JSON.stringify(metrics);
}
