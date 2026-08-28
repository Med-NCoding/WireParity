/**
 * WireParity - Contract-Aware Header & Transport Normalizer (Step 4.1)
 *
 * Strips non-semantic transport headers and lowercases remaining header
 * keys, guided by the IROperation contract. This ensures that transport
 * noise does not produce spurious divergences between SDK-generated requests.
 *
 * Non-semantic headers stripped unconditionally:
 *   user-agent, host, connection, content-length, accept-encoding
 *
 * Any `header` parameters declared in the IROperation contract are
 * preserved verbatim (with lowercased key) even if they would otherwise
 * match the noise list — the contract takes precedence.
 */

import type { IROperation } from "../ir/operations.js";
import type { CapturedRequest } from "../capture/types.js";

/**
 * Transport-level headers that carry no semantic meaning for API
 * contract comparison. These are stripped before diffing.
 *
 * Includes the five mandated noise headers plus runtime-injected defaults:
 *  - accept, accept-language: injected by Node.js undici fetch; not set by Python urllib
 *  - sec-fetch-*: Fetch metadata headers injected by browser/Node fetch runtimes
 */
export const TRANSPORT_HEADERS: ReadonlySet<string> = new Set([
  "user-agent",
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  // Node.js undici fetch runtime defaults (not sent by Python urllib)
  "accept",
  "accept-language",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
]);

/**
 * Result of header normalization: a flat map of lowercase header name
 * to its string value, with transport noise removed.
 */
export type NormalizedHeaders = Record<string, string>;

/**
 * Normalizes the headers of a captured request against the IROperation
 * contract.
 *
 * Algorithm:
 *  1. Collect the set of header parameter names declared in the operation
 *     (these are always preserved, even if they share a name with a
 *     transport-noise header).
 *  2. Iterate raw headers; lowercase each key.
 *  3. Drop the key if it is in TRANSPORT_HEADERS AND not in the contract
 *     header set.
 *  4. Collapse multi-value headers to a comma-separated string (RFC 7230).
 *
 * @param raw       - The raw captured HTTP request.
 * @param operation - The IR operation defining the API contract.
 * @returns         A NormalizedHeaders map safe for semantic comparison.
 */
export function normalizeHeaders(
  raw: CapturedRequest,
  operation: IROperation
): NormalizedHeaders {
  // Build the set of contract-declared header parameter names (lowercased).
  const contractHeaders = new Set<string>(
    operation.parameters
      .filter((p) => p.in === "header")
      .map((p) => p.name.toLowerCase())
  );

  const normalized: NormalizedHeaders = {};

  for (const [key, value] of Object.entries(raw.headers)) {
    if (value === undefined) {
      continue;
    }

    const lowerKey = key.toLowerCase().trim();

    // Strip transport noise unless the contract explicitly declares this header.
    if (TRANSPORT_HEADERS.has(lowerKey) && !contractHeaders.has(lowerKey)) {
      continue;
    }

    // Node.js undici fetch automatically injects 'accept-language: *' by default when omitted.
    if (lowerKey === "accept-language" && String(value).trim() === "*") {
      continue;
    }


    // Collapse multi-value headers to comma-separated (RFC 7230 §3.2.2).
    let stringVal = Array.isArray(value)
      ? value.join(", ")
      : String(value);

    // Normalize Content-Type header to standard media type (e.g. "application/json; charset=utf-8" -> "application/json")
    if (lowerKey === "content-type" && stringVal.includes(";")) {
      stringVal = stringVal.split(";")[0]!.trim().toLowerCase();
    }

    normalized[lowerKey] = stringVal.trim();
  }

  return normalized;
}

