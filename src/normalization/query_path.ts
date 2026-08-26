/**
 * WireParity - Strict Path & Contract-Aware Query Normalizer (Step 4.2)
 *
 * Two responsibilities:
 *
 * 1. PATH — strict preservation.
 *    Path slashes are NEVER collapsed or stripped. Duplicate slashes (//)
 *    and trailing slashes (/) are part of the wire contract; differences
 *    must be reported as real divergences, not normalized away.
 *
 * 2. QUERY — contract-aware ordering.
 *    Repeated query parameter values (e.g. ?tags=a&tags=b) are preserved
 *    in their original order by default.
 *    The ONLY exception: when the API contract explicitly marks the
 *    parameter's schema as `uniqueItems: true` AND the schema type is
 *    "array", the values are treated as an unordered set and sorted
 *    before comparison. This avoids false positives for genuinely
 *    order-irrelevant set parameters.
 *
 *    Important: `uniqueItems: true` alone does NOT imply order-irrelevance
 *    unless the parameter is explicitly typed as "array". A plain string
 *    parameter is never sorted.
 */

import type { IROperation } from "../ir/operations.js";
import type { CapturedRequest } from "../capture/types.js";

/**
 * Result of path + query normalization.
 */
export interface NormalizedPathQuery {
  /** The path exactly as received — no slash manipulation. */
  path: string;
  /**
   * Query parameters keyed by name, each holding an ordered array of
   * string values. For set-semantic parameters the array is sorted.
   */
  query: Record<string, string[]>;
}

/**
 * Determines whether the query parameter with the given name should be
 * treated as an unordered set (i.e., its values sorted before diffing).
 *
 * Returns true only when ALL of the following hold:
 *  - The operation declares a query parameter with that name.
 *  - The parameter's schema has type "array".
 *  - The array schema has `uniqueItems: true`.
 */
function isSetSemanticParam(name: string, operation: IROperation): boolean {
  const param = operation.parameters.find(
    (p) => p.in === "query" && p.name === name
  );
  if (!param) return false;
  const schema = param.schema;
  return schema.type === "array" && schema.uniqueItems === true;
}

/**
 * Normalizes the path and query of a captured request against the
 * IROperation contract.
 *
 * Path: returned verbatim (no slash modification of any kind).
 * Query: values preserved in wire order; sorted only for explicitly
 *        contract-declared array+uniqueItems parameters.
 *
 * @param raw       - The raw captured HTTP request.
 * @param operation - The IR operation defining the API contract.
 * @returns         NormalizedPathQuery safe for semantic comparison.
 */
export function normalizePathQuery(
  raw: CapturedRequest,
  operation: IROperation
): NormalizedPathQuery {
  // ── Path: strict preservation ─────────────────────────────────────────
  const path = raw.path;

  // ── Query: contract-aware ordering ───────────────────────────────────
  const query: Record<string, string[]> = {};

  for (const [key, val] of Object.entries(raw.query)) {
    // Coerce to string array, preserving wire order
    let values: string[];
    if (Array.isArray(val)) {
      values = [...val];
    } else if (typeof val === "string") {
      values = [val];
    } else {
      values = [];
    }

    // Sort only for explicitly set-semantic parameters
    if (isSetSemanticParam(key, operation)) {
      values = [...values].sort();
    }

    query[key] = values;
  }

  return { path, query };
}
