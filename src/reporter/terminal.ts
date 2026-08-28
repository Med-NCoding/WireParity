import type { ComparisonResult, SemanticDiff } from "../comparator/types.js";
import type { IRValueRecord } from "../ir/values.js";
import { irRecordToJs } from "../runners/translator.js";

export interface ParityReportItem {
  operationId: string;
  hasDivergence: boolean;
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

export function formatTerminalReport(report: ParityReport): string {
  const lines: string[] = [];

  lines.push("=================================================");
  lines.push(`  WireParity Differential Parity Report`);
  lines.push(`  Spec: ${report.title} (Seed: ${report.seed})`);
  lines.push("=================================================");

  for (const item of report.results) {
    if (!item.hasDivergence) {
      lines.push(`\n[PASS] Operation: ${item.operationId} (${item.durationMs}ms)`);
      lines.push(`  ✓ All SDKs produced semantically equivalent HTTP wire requests`);
    } else {
      lines.push(`\n[FAIL] Operation: ${item.operationId} (${item.durationMs}ms)`);
      lines.push(`  Found ${item.diffs.length} divergence(s):`);

      for (const diff of item.diffs) {
        lines.push(`  - [${diff.category}] ${diff.path}`);
        lines.push(`    Explanation: ${diff.message}`);
        lines.push(`    ${diff.sdkA}: ${JSON.stringify(diff.expected)}`);
        lines.push(`    ${diff.sdkB}: ${JSON.stringify(diff.actual)}`);
      }

      if (item.replayToken) {
        lines.push(`\n  Replay Token: ${item.replayToken}`);
      }

      if (item.minimizedReproducer) {
        lines.push(`\n  Minimal Reproducible Input (after ${item.shrinkingSteps ?? 0} shrink steps):`);
        lines.push(`  ${JSON.stringify(item.minimizedReproducer, null, 2)}`);
      }
    }
  }

  lines.push("\n-------------------------------------------------");
  lines.push(`Summary: ${report.passedOperations}/${report.totalOperations} operations matched.`);
  if (report.divergentOperations > 0) {
    lines.push(`Status: FAILED (${report.divergentOperations} divergence(s) detected)`);
  } else {
    lines.push(`Status: SUCCESS (100% wire parity)`);
  }
  lines.push("=================================================");

  return lines.join("\n");
}

