/**
 * WireParity - Query Encoding & Header Auth Classifier (Step 7.2)
 *
 * Provides focused classification functions for two critical divergence categories:
 *
 *   1. QUERY_ENCODING_DIVERGENCE - Mismatches in query parameter serialization styles
 *      (e.g., exploded arrays `tags=a&tags=b` vs comma-joined `tags=a,b`, pipe-delimited
 *      `tags=a|b`, space-delimited `tags=a b`, bracket notation `tags[]` vs `tags`,
 *      or URL percent-encoding variations).
 *
 *   2. AUTH_HEADER_SCHEME - Discrepancies in authentication header formatting
 *      (e.g., missing `Bearer ` prefix, scheme casing `bearer` vs `Bearer`,
 *      scheme mismatches like `Bearer` vs `Basic`, whitespace irregularities,
 *      or header name variations like `X-API-Key` vs `Authorization`).
 */

import type { DivergenceCategory, DiffSeverity, ClassificationResult } from "../types.js";
export type { ClassificationResult };


// ─── Query Parameter Delimiter Helpers ────────────────────────────────────────

/**
 * Extracts elements from a raw query value which may be:
 *  - string[] (array of values)
 *  - string (scalar value or delimited string)
 *  - number/boolean (primitives)
 */
function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => String(v));
  }
  if (val === null || val === undefined) {
    return [];
  }
  return [String(val)];
}

// ─── Query Encoding Classifier ───────────────────────────────────────────────

/**
 * Detects query array serialization and encoding style discrepancies:
 *  - Exploded array (`["a", "b"]`) vs comma-joined (`["a,b"]` or `"a,b"`)
 *  - Exploded array (`["a", "b"]`) vs pipe-delimited (`["a|b"]` or `"a|b"`)
 *  - Exploded array (`["a", "b"]`) vs space-delimited (`["a b"]` or `"a b"` or `"a+b"`)
 *  - Array wrapped vs scalar (`["val"]` vs `"val"`)
 *  - Multi-value delimiter mismatch (comma vs pipe vs space)
 *
 * @param paramName - The query parameter key name
 * @param valA      - Query value from SDK A
 * @param valB      - Query value from SDK B
 * @returns ClassificationResult if query encoding divergence is detected, null otherwise
 */
export function classifyQueryArrayEncoding(
  paramName: string,
  valA: unknown,
  valB: unknown
): ClassificationResult | null {
  if (valA === undefined || valB === undefined || valA === null || valB === null) {
    return null;
  }

  const arrA = toStringArray(valA);
  const arrB = toStringArray(valB);

  // 1. Array vs Scalar wrapping (e.g. ["val"] vs "val")
  if (
    (Array.isArray(valA) && !Array.isArray(valB) && arrA.length === 1 && arrA[0] === String(valB)) ||
    (!Array.isArray(valA) && Array.isArray(valB) && arrB.length === 1 && arrB[0] === String(valA))
  ) {
    return {
      category: "QUERY_ENCODING_DIVERGENCE",
      severity: "warning",
      message: `Query parameter '${paramName}' scalar vs array wrapping divergence: SDK A sent ${JSON.stringify(valA)}, SDK B sent ${JSON.stringify(valB)}`,
    };
  }

  // 2. Exploded array vs Comma-joined (form style, explode: false)
  if (arrA.length > 1 && arrB.length === 1) {
    const joinedA = arrA.join(",");
    const rawB = arrB[0]!;
    if (rawB === joinedA || rawB.split(",").join(",") === joinedA) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query array style divergence on '${paramName}': SDK A sent exploded array [${arrA.map((s) => `'${s}'`).join(", ")}], but SDK B sent comma-joined string '${rawB}'`,
      };
    }
  }

  if (arrB.length > 1 && arrA.length === 1) {
    const joinedB = arrB.join(",");
    const rawA = arrA[0]!;
    if (rawA === joinedB || rawA.split(",").join(",") === joinedB) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query array style divergence on '${paramName}': SDK A sent comma-joined string '${rawA}', but SDK B sent exploded array [${arrB.map((s) => `'${s}'`).join(", ")}]`,
      };
    }
  }

  // 3. Exploded array vs Pipe-delimited (style: pipeDelimited)
  if (arrA.length > 1 && arrB.length === 1) {
    const pipeJoinedA = arrA.join("|");
    const rawB = arrB[0]!;
    if (rawB === pipeJoinedA || rawB.split("|").join("|") === pipeJoinedA) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query array style divergence on '${paramName}': SDK A sent exploded array [${arrA.map((s) => `'${s}'`).join(", ")}], but SDK B sent pipe-delimited string '${rawB}'`,
      };
    }
  }

  if (arrB.length > 1 && arrA.length === 1) {
    const pipeJoinedB = arrB.join("|");
    const rawA = arrA[0]!;
    if (rawA === pipeJoinedB || rawA.split("|").join("|") === pipeJoinedB) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query array style divergence on '${paramName}': SDK A sent pipe-delimited string '${rawA}', but SDK B sent exploded array [${arrB.map((s) => `'${s}'`).join(", ")}]`,
      };
    }
  }

  // 4. Exploded array vs Space-delimited (style: spaceDelimited)
  if (arrA.length > 1 && arrB.length === 1) {
    const spaceJoinedA = arrA.join(" ");
    const rawB = arrB[0]!;
    if (
      rawB === spaceJoinedA ||
      rawB.replace(/\+/g, " ") === spaceJoinedA ||
      rawB.split(" ").join(" ") === spaceJoinedA
    ) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query array style divergence on '${paramName}': SDK A sent exploded array [${arrA.map((s) => `'${s}'`).join(", ")}], but SDK B sent space-delimited string '${rawB}'`,
      };
    }
  }

  if (arrB.length > 1 && arrA.length === 1) {
    const spaceJoinedB = arrB.join(" ");
    const rawA = arrA[0]!;
    if (
      rawA === spaceJoinedB ||
      rawA.replace(/\+/g, " ") === spaceJoinedB ||
      rawA.split(" ").join(" ") === spaceJoinedB
    ) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query array style divergence on '${paramName}': SDK A sent space-delimited string '${rawA}', but SDK B sent exploded array [${arrB.map((s) => `'${s}'`).join(", ")}]`,
      };
    }
  }

  // 5. Delimiter mismatch between two single strings (e.g. comma vs pipe)
  if (arrA.length === 1 && arrB.length === 1 && arrA[0] !== arrB[0]) {
    const strA = arrA[0]!;
    const strB = arrB[0]!;
    const commaSplitA = strA.split(",");
    const pipeSplitB = strB.split("|");
    if (
      commaSplitA.length > 1 &&
      pipeSplitB.length > 1 &&
      JSON.stringify(commaSplitA) === JSON.stringify(pipeSplitB)
    ) {
      return {
        category: "QUERY_ENCODING_DIVERGENCE",
        severity: "critical",
        message: `Query delimiter mismatch on '${paramName}': SDK A used comma-separated '${strA}', SDK B used pipe-separated '${strB}'`,
      };
    }
  }

  // 6. Generic array length difference (one is joined/condensed, other is not)
  if (Array.isArray(valA) && Array.isArray(valB) && valA.length !== valB.length) {
    return {
      category: "QUERY_ENCODING_DIVERGENCE",
      severity: "critical",
      message: `Query array formatting divergence for '${paramName}': [${valA.join(",")}] vs [${valB.join(",")}]`,
    };
  }

  return null;
}

/**
 * Detects bracket notation key differences (e.g. `tags[]` vs `tags`, `ids[0]` vs `ids[]`).
 *
 * @param keyA - Parameter key from SDK A
 * @param keyB - Parameter key from SDK B
 * @returns ClassificationResult if bracket notation divergence is found, null otherwise
 */
export function classifyQueryKeyNotation(
  keyA: string,
  keyB: string
): ClassificationResult | null {
  if (keyA === keyB) return null;

  const baseA = keyA.replace(/\[\d*\]$/, "");
  const baseB = keyB.replace(/\[\d*\]$/, "");

  if (baseA === baseB && baseA.length > 0) {
    return {
      category: "QUERY_ENCODING_DIVERGENCE",
      severity: "critical",
      message: `Query parameter key notation divergence: SDK A used '${keyA}', SDK B used '${keyB}' for logical parameter '${baseA}'`,
    };
  }

  return null;
}

/**
 * Detects URL percent-encoding differences between query values (e.g. `+` vs `%20`, `%2F` vs `/`).
 */
export function classifyQueryValueEncoding(
  paramName: string,
  valA: unknown,
  valB: unknown
): ClassificationResult | null {
  if (typeof valA !== "string" || typeof valB !== "string") return null;
  if (valA === valB) return null;

  // Check if unescaped / decoded values are identical
  const decodedA = safeDecodeURIComponent(valA.replace(/\+/g, " "));
  const decodedB = safeDecodeURIComponent(valB.replace(/\+/g, " "));

  if (decodedA === decodedB && decodedA.length > 0) {
    return {
      category: "QUERY_ENCODING_DIVERGENCE",
      severity: "warning",
      message: `Query value percent-encoding variation for '${paramName}': '${valA}' vs '${valB}' (both decode to '${decodedA}')`,
    };
  }

  return null;
}

function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Full query parameter divergence classifier.
 * Checks for array encoding, key notation, percent-encoding, missing keys, and value mismatches.
 */
export function classifyQueryDivergence(
  paramName: string,
  valA: unknown,
  valB: unknown
): ClassificationResult {
  if (valA === undefined && valB !== undefined) {
    return {
      category: "QUERY_KEY_MISSING",
      severity: "critical",
      message: `Query parameter '${paramName}' was omitted by SDK A but sent by SDK B (${JSON.stringify(valB)})`,
    };
  }

  if (valA !== undefined && valB === undefined) {
    return {
      category: "QUERY_KEY_MISSING",
      severity: "critical",
      message: `Query parameter '${paramName}' was sent by SDK A (${JSON.stringify(valA)}) but omitted by SDK B`,
    };
  }

  const arrayEncodingDiff = classifyQueryArrayEncoding(paramName, valA, valB);
  if (arrayEncodingDiff) return arrayEncodingDiff;

  const valueEncodingDiff = classifyQueryValueEncoding(paramName, valA, valB);
  if (valueEncodingDiff) return valueEncodingDiff;

  return {
    category: "QUERY_VALUE_MISMATCH",
    severity: "critical",
    message: `Query parameter '${paramName}' value divergence: '${valA}' vs '${valB}'`,
  };
}

/**
 * Scans two query records, detecting missing keys, bracket variations, and encoding differences.
 */
export function scanQueryParams(
  queryA: Record<string, unknown>,
  queryB: Record<string, unknown>,
  _sdkA = "SDK A",
  _sdkB = "SDK B"
): Array<{ path: string; result: ClassificationResult }> {
  const diffs: Array<{ path: string; result: ClassificationResult }> = [];
  const keysA = Object.keys(queryA);
  const keysB = Object.keys(queryB);
  const handledKeysB = new Set<string>();

  for (const keyA of keysA) {
    if (Object.prototype.hasOwnProperty.call(queryB, keyA)) {
      handledKeysB.add(keyA);
      const valA = queryA[keyA];
      const valB = queryB[keyA];
      if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        diffs.push({
          path: `query.${keyA}`,
          result: classifyQueryDivergence(keyA, valA, valB),
        });
      }
    } else {
      // Check if B has a bracket notation variant (e.g. keyA='tags', keyB='tags[]')
      let matchedVariant: string | null = null;
      for (const keyB of keysB) {
        if (!handledKeysB.has(keyB)) {
          const notationDiff = classifyQueryKeyNotation(keyA, keyB);
          if (notationDiff) {
            matchedVariant = keyB;
            handledKeysB.add(keyB);
            diffs.push({
              path: `query.${keyA}`,
              result: notationDiff,
            });
            break;
          }
        }
      }

      if (!matchedVariant) {
        diffs.push({
          path: `query.${keyA}`,
          result: {
            category: "QUERY_KEY_MISSING",
            severity: "critical",
            message: `Query parameter '${keyA}' was sent by SDK A but omitted by SDK B`,
          },
        });
      }
    }
  }

  for (const keyB of keysB) {
    if (!handledKeysB.has(keyB)) {
      diffs.push({
        path: `query.${keyB}`,
        result: {
          category: "QUERY_KEY_MISSING",
          severity: "critical",
          message: `Query parameter '${keyB}' was omitted by SDK A but sent by SDK B`,
        },
      });
    }
  }

  return diffs;
}

// ─── Header Auth Classifier ──────────────────────────────────────────────────

const AUTH_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "apikey",
  "token",
  "x-access-token",
]);

/**
 * Returns true if the lowercase header name is known to carry authentication credentials.
 */
export function isAuthHeaderName(headerName: string): boolean {
  return AUTH_HEADER_NAMES.has(headerName.toLowerCase());
}

/**
 * Parses an Authorization header value into its scheme prefix and token payload.
 * e.g. "Bearer eyJhbGci..." -> { scheme: "Bearer", token: "eyJhbGci..." }
 *      "Basic dXNlcjpwYXNz" -> { scheme: "Basic", token: "dXNlcjpwYXNz" }
 *      "raw-token-123"      -> { scheme: null, token: "raw-token-123" }
 */
export function parseAuthHeaderValue(value: string): {
  scheme: string | null;
  token: string;
  raw: string;
  hasExtraSpace: boolean;
} {
  const trimmed = value.trim();
  const match = /^([A-Za-z0-9_-]+)(\s+)(.+)$/.exec(trimmed);

  if (match) {
    const scheme = match[1]!;
    const space = match[2]!;
    const token = match[3]!;
    return {
      scheme,
      token,
      raw: value,
      hasExtraSpace: space.length > 1,
    };
  }

  return {
    scheme: null,
    token: trimmed,
    raw: value,
    hasExtraSpace: false,
  };
}

/**
 * Classifies discrepancies in authentication header values:
 *  - Missing scheme prefix (e.g. `Bearer <token>` vs `<token>`)
 *  - Scheme mismatch (e.g. `Bearer <token>` vs `Basic <token>`)
 *  - Scheme casing mismatch (e.g. `Bearer <token>` vs `bearer <token>`)
 *  - Scheme spacing irregularity (e.g. `Bearer  <token>` vs `Bearer <token>`)
 *  - Missing authorization header (omitted vs present)
 *
 * @param headerName - The header name (e.g. "authorization", "x-api-key")
 * @param valA       - Header value from SDK A
 * @param valB       - Header value from SDK B
 * @param sdkA       - Label for SDK A
 * @param sdkB       - Label for SDK B
 * @returns ClassificationResult if an auth divergence is detected, null otherwise
 */
export function classifyAuthHeaderDivergence(
  headerName: string,
  valA: unknown,
  valB: unknown,
  sdkA = "SDK A",
  sdkB = "SDK B"
): ClassificationResult | null {
  const isAuth = isAuthHeaderName(headerName);
  if (!isAuth) return null;

  // Missing header entirely
  if (valA === undefined && valB !== undefined) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "critical",
      message: `Auth header '${headerName}' was omitted by ${sdkA} but sent by ${sdkB} ('${valB}')`,
    };
  }

  if (valA !== undefined && valB === undefined) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "critical",
      message: `Auth header '${headerName}' was sent by ${sdkA} ('${valA}') but omitted by ${sdkB}`,
    };
  }

  if (typeof valA !== "string" || typeof valB !== "string") {
    return null;
  }

  if (valA === valB) {
    return null;
  }

  const parsedA = parseAuthHeaderValue(valA);
  const parsedB = parseAuthHeaderValue(valB);

  // 1. Missing scheme prefix: one has scheme, other has raw token matching
  if (parsedA.scheme && !parsedB.scheme && parsedA.token === parsedB.token) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "critical",
      message: `Auth scheme prefix missing: ${sdkA} included '${parsedA.scheme} ' prefix ('${valA}'), but ${sdkB} sent raw token without prefix ('${valB}')`,
    };
  }

  if (!parsedA.scheme && parsedB.scheme && parsedA.token === parsedB.token) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "critical",
      message: `Auth scheme prefix missing: ${sdkA} sent raw token without prefix ('${valA}'), but ${sdkB} included '${parsedB.scheme} ' prefix ('${valB}')`,
    };
  }

  // 2. Scheme mismatch (e.g. Bearer vs Basic or Bearer vs Token)
  if (
    parsedA.scheme &&
    parsedB.scheme &&
    parsedA.scheme.toLowerCase() !== parsedB.scheme.toLowerCase()
  ) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "critical",
      message: `Auth scheme mismatch on '${headerName}': ${sdkA} used '${parsedA.scheme}', ${sdkB} used '${parsedB.scheme}'`,
    };
  }

  // 3. Scheme casing mismatch (e.g. Bearer vs bearer)
  if (
    parsedA.scheme &&
    parsedB.scheme &&
    parsedA.scheme.toLowerCase() === parsedB.scheme.toLowerCase() &&
    parsedA.scheme !== parsedB.scheme
  ) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "critical",
      message: `Auth scheme casing mismatch on '${headerName}': ${sdkA} used '${parsedA.scheme}', ${sdkB} used '${parsedB.scheme}'`,
    };
  }

  // 4. Whitespace difference between scheme and token (e.g. 'Bearer  token')
  if (
    parsedA.scheme &&
    parsedB.scheme &&
    parsedA.scheme === parsedB.scheme &&
    parsedA.token === parsedB.token &&
    (parsedA.hasExtraSpace || parsedB.hasExtraSpace)
  ) {
    return {
      category: "AUTH_HEADER_SCHEME",
      severity: "warning",
      message: `Auth header spacing irregularity on '${headerName}': '${valA}' vs '${valB}'`,
    };
  }

  // 5. Token value mismatch under the same scheme
  return {
    category: "AUTH_HEADER_SCHEME",
    severity: "critical",
    message: `Auth header value mismatch on '${headerName}': '${valA}' vs '${valB}'`,
  };
}

/**
 * Detects header key placement mismatch for auth (e.g. SDK A uses Authorization, SDK B uses X-API-Key).
 */
export function classifyAuthHeaderKeyMismatch(
  headersA: Record<string, string>,
  headersB: Record<string, string>,
  sdkA = "SDK A",
  sdkB = "SDK B"
): ClassificationResult | null {
  const normA = Object.fromEntries(
    Object.entries(headersA).map(([k, v]) => [k.toLowerCase(), v])
  );
  const normB = Object.fromEntries(
    Object.entries(headersB).map(([k, v]) => [k.toLowerCase(), v])
  );

  // Check Authorization vs X-API-Key with same token
  const authA = normA["authorization"];
  const apiKeyA = normA["x-api-key"] ?? normA["api-key"];
  const authB = normB["authorization"];
  const apiKeyB = normB["x-api-key"] ?? normB["api-key"];

  if (authA && apiKeyB && !authB && !apiKeyA) {
    const tokenA = parseAuthHeaderValue(authA).token;
    if (tokenA === apiKeyB) {
      return {
        category: "AUTH_HEADER_SCHEME",
        severity: "critical",
        message: `Auth header location divergence: ${sdkA} sent credentials via 'Authorization: ${authA}', but ${sdkB} sent via 'X-API-Key: ${apiKeyB}'`,
      };
    }
  }

  if (apiKeyA && authB && !apiKeyB && !authA) {
    const tokenB = parseAuthHeaderValue(authB).token;
    if (apiKeyA === tokenB) {
      return {
        category: "AUTH_HEADER_SCHEME",
        severity: "critical",
        message: `Auth header location divergence: ${sdkA} sent credentials via 'X-API-Key: ${apiKeyA}', but ${sdkB} sent via 'Authorization: ${authB}'`,
      };
    }
  }

  return null;
}

/**
 * Scans all headers for authentication divergences.
 */
export function scanHeadersForAuthDivergences(
  headersA: Record<string, string>,
  headersB: Record<string, string>,
  sdkA = "SDK A",
  sdkB = "SDK B"
): Array<{ path: string; result: ClassificationResult }> {
  const diffs: Array<{ path: string; result: ClassificationResult }> = [];

  const keyMismatch = classifyAuthHeaderKeyMismatch(headersA, headersB, sdkA, sdkB);
  if (keyMismatch) {
    diffs.push({ path: "headers.authorization", result: keyMismatch });
    return diffs;
  }

  const allKeys = Array.from(
    new Set([...Object.keys(headersA), ...Object.keys(headersB)])
  );

  for (const key of allKeys) {
    if (isAuthHeaderName(key)) {
      const valA = headersA[key];
      const valB = headersB[key];
      const res = classifyAuthHeaderDivergence(key, valA, valB, sdkA, sdkB);
      if (res) {
        diffs.push({ path: `headers.${key}`, result: res });
      }
    }
  }

  return diffs;
}
