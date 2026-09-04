/**
 * WireParity - Terminal Parity Report Formatter (Step 9.1)
 *
 * Formats differential parity test results for human-friendly terminal display:
 *   - Visual [PASS] / [FAIL] operation badges
 *   - Categorized semantic divergence explanations
 *   - Minimal counterexample JSON code blocks with shrinking statistics
 *   - Execution seeds and single-shot replay paths / tokens
 *   - ANSI color highlighting support
 */

import type { SemanticDiff } from "../comparator/types.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ParityReportItem {
  operationId: string;
  hasDivergence: boolean;
  executionError?: string;
  diffs: SemanticDiff[];
  minimizedReproducer?: Record<string, unknown>;
  shrinkingSteps?: number;
  seed?: number;
  path?: string;
  replayToken?: string;
  durationMs: number;
}

export interface ParityReport {
  title: string;
  seed: string | number;
  totalOperations: number;
  passedOperations: number;
  divergentOperations: number;
  results: ParityReportItem[];
}

export interface TerminalFormatterOptions {
  /** Whether to output ANSI color codes (default: false for predictable string output) */
  colors?: boolean;
  /** Whether to show CLI command instructions to reproduce the failure */
  showReplayInstructions?: boolean;
}

// ─── ANSI Color Utilities ─────────────────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function colorize(text: string, colorCode: string, enable = false): string {
  if (!enable) return text;
  return `${colorCode}${text}${ANSI.reset}`;
}

// ─── Item Formatter ───────────────────────────────────────────────────────────

/**
 * Formats a single ParityReportItem for terminal display.
 */
export function formatOperationItem(
  item: ParityReportItem,
  options: TerminalFormatterOptions = {}
): string {
  const useColors = options.colors ?? false;
  const showReplay = options.showReplayInstructions ?? true;
  const lines: string[] = [];

  if (!item.hasDivergence && !item.executionError) {
    const badge = colorize("[PASS]", ANSI.green + ANSI.bold, useColors);
    const op = colorize(item.operationId, ANSI.bold, useColors);
    const dur = colorize(`(${item.durationMs}ms)`, ANSI.dim, useColors);
    lines.push(`\n${badge} Operation: ${op} ${dur}`);
    lines.push(`  ✓ All SDKs produced semantically equivalent HTTP wire requests`);
    return lines.join("\n");
  }

  // Failure
  const badge = item.executionError
    ? colorize("[ERROR]", ANSI.red + ANSI.bold, useColors)
    : colorize("[FAIL]", ANSI.red + ANSI.bold, useColors);
  const op = colorize(item.operationId, ANSI.bold, useColors);
  const dur = colorize(`(${item.durationMs}ms)`, ANSI.dim, useColors);
  lines.push(`\n${badge} Operation: ${op} ${dur}`);

  if (item.executionError) {
    lines.push(`  ✖ Execution error: ${item.executionError}`);
  }

  const semanticDiffs = item.diffs.filter((d) => d.category !== "RUNNER_EXECUTION_ERROR");
  if (semanticDiffs.length > 0) {
    lines.push(`  Found ${semanticDiffs.length} divergence(s):`);

    for (const diff of semanticDiffs) {
      const categoryBadge = colorize(`[${diff.category}]`, ANSI.yellow + ANSI.bold, useColors);
      const location = colorize(diff.path, ANSI.cyan, useColors);
      const severityTag = diff.severity ? ` (severity: ${diff.severity})` : "";
      lines.push(`  - ${categoryBadge} ${location}${severityTag}`);
      lines.push(`    Explanation: ${diff.message}`);
      lines.push(`    ${diff.sdkA}: ${JSON.stringify(diff.expected)}`);
      lines.push(`    ${diff.sdkB}: ${JSON.stringify(diff.actual)}`);
    }
  }

  // Replay Metadata
  if (item.replayToken) {
    lines.push(`\n  Replay Token: ${colorize(item.replayToken, ANSI.magenta, useColors)}`);
  }
  if (item.seed !== undefined && item.path) {
    lines.push(`  Replay Path: ${item.path} (Seed: ${item.seed})`);
    if (showReplay) {
      lines.push(`  Replay CLI: wireparity --seed ${item.seed} --replay-path ${item.path} --operations ${item.operationId}`);
    }
  }

  // Minimal Reproducer Block
  if (item.minimizedReproducer) {
    const shrinkInfo = item.shrinkingSteps !== undefined ? ` (after ${item.shrinkingSteps} shrink steps)` : "";
    lines.push(`\n  Minimal Reproducible Input${shrinkInfo}:`);
    const jsonStr = JSON.stringify(item.minimizedReproducer, null, 2);
    lines.push(`  \`\`\`json\n${jsonStr.split("\n").map((l) => `  ${l}`).join("\n")}\n  \`\`\``);
  }

  return lines.join("\n");
}

// ─── Summary Formatter ────────────────────────────────────────────────────────

/**
 * Formats the summary statistics block of a ParityReport.
 */
export function formatTerminalSummary(
  report: ParityReport,
  options: TerminalFormatterOptions = {}
): string {
  const useColors = options.colors ?? false;
  const lines: string[] = [];

  lines.push("\n-------------------------------------------------");
  lines.push(`Summary: ${report.passedOperations}/${report.totalOperations} operations matched.`);

  if (report.divergentOperations > 0) {
    const statusText = colorize(
      `Status: FAILED (${report.divergentOperations} divergence(s) detected)`,
      ANSI.red + ANSI.bold,
      useColors
    );
    lines.push(statusText);
  } else {
    const statusText = colorize(
      `Status: SUCCESS (100% wire parity)`,
      ANSI.green + ANSI.bold,
      useColors
    );
    lines.push(statusText);
  }
  lines.push("=================================================");

  return lines.join("\n");
}

// ─── Full Report Formatter ────────────────────────────────────────────────────

/**
 * Formats the complete ParityReport as a structured terminal document.
 */
export function formatTerminalReport(
  report: ParityReport,
  options: TerminalFormatterOptions = {}
): string {
  const useColors = options.colors ?? false;
  const lines: string[] = [];

  lines.push("=================================================");
  lines.push(`  WireParity Differential Parity Report`);
  lines.push(`  Spec: ${colorize(report.title, ANSI.bold, useColors)} (Seed: ${report.seed})`);
  lines.push("=================================================");

  for (const item of report.results) {
    lines.push(formatOperationItem(item, options));
  }

  lines.push(formatTerminalSummary(report, options));

  return lines.join("\n");
}
