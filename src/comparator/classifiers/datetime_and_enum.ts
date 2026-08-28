/**
 * WireParity - Date/Time Format & Enum Value Classifier (Step 7.3)
 *
 * Provides focused classification functions for two critical divergence categories:
 *
 *   1. DATETIME_FORMAT_MISMATCH - Discrepancies in timestamp and date representation
 *      (e.g., ISO-8601 string vs Unix epoch integer, millisecond precision variations,
 *      timezone offset differences such as +00:00 vs Z, date-only vs date-time,
 *      or RFC-1123 vs ISO-8601).
 *
 *   2. ENUM_SERIALIZATION_ERROR - Discrepancies in enum value serialization
 *      (e.g., ordinal integer 0/1 vs string name "available", uppercase vs lowercase
 *      "PLACED" vs "placed", or type-prefixed enum strings "StatusAvailable" vs "available").
 */

import type { DivergenceCategory, DiffSeverity, ClassificationResult } from "../types.js";
export type { ClassificationResult };

// ─── Date / Time Helpers ──────────────────────────────────────────────────────

/** ISO-8601 Date-Time regex (with optional millis and timezone offset / Z) */
const ISO_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** ISO-8601 Date-only regex (YYYY-MM-DD) */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** RFC-1123 / HTTP Date regex (e.g. "Mon, 15 Jan 2024 12:30:00 GMT") */
const RFC1123_DATE_REGEX =
  /^[A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/i;

/**
 * Returns true if the string matches an ISO-8601 date-time format.
 */
export function isIso8601String(val: unknown): val is string {
  return typeof val === "string" && ISO_DATETIME_REGEX.test(val.trim());
}

/**
 * Returns true if the string matches a date-only format (YYYY-MM-DD).
 */
export function isDateOnlyString(val: unknown): val is string {
  return typeof val === "string" && ISO_DATE_REGEX.test(val.trim());
}

/**
 * Returns true if the string matches an RFC-1123 / HTTP date format.
 */
export function isRfc1123DateString(val: unknown): val is string {
  return typeof val === "string" && RFC1123_DATE_REGEX.test(val.trim());
}

/**
 * Returns true if the value represents a plausible Unix timestamp
 * (either in seconds: ~1e9 to 3e9, or in milliseconds: ~1e12 to 3e12).
 */
export function isUnixTimestampNumber(val: unknown): val is number {
  if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
    return false;
  }
  // Plausible range: from 1970 (0) to ~2100 (4.1e9 seconds or 4.1e12 ms)
  const isSeconds = val >= 0 && val <= 4_200_000_000 && Number.isInteger(val);
  const isMillis = val >= 0 && val <= 4_200_000_000_000 && Number.isInteger(val);
  return isSeconds || isMillis;
}

// ─── DATETIME_FORMAT_MISMATCH Classifier ─────────────────────────────────────

/**
 * Classifies timestamp and date representation discrepancies between two SDK outputs:
 *  - ISO-8601 string vs Unix epoch number (seconds or milliseconds)
 *  - ISO-8601 string vs numeric string epoch (e.g. "1705321800")
 *  - Millisecond precision differences (e.g. ".000Z" vs "Z")
 *  - Timezone offset representation (e.g. "+00:00" vs "Z" or offset equivalence)
 *  - Date-only (YYYY-MM-DD) vs Date-time (YYYY-MM-DDTHH:mm:ssZ)
 *  - RFC-1123 / HTTP date vs ISO-8601
 *
 * @param path - Property path string (e.g. "body.createdAt")
 * @param valA - Value from SDK A
 * @param valB - Value from SDK B
 * @param sdkA - Label for SDK A
 * @param sdkB - Label for SDK B
 * @returns ClassificationResult if a datetime divergence is found, null otherwise
 */
export function classifyDateTimeDivergence(
  path: string,
  valA: unknown,
  valB: unknown,
  sdkA = "SDK A",
  sdkB = "SDK B"
): ClassificationResult | null {
  if (valA === undefined || valB === undefined || valA === null || valB === null) {
    return null;
  }

  if (valA === valB) {
    return null;
  }

  // 1. ISO-8601 String vs Unix Epoch Number (e.g. "2024-01-15T12:00:00Z" vs 1705320000)
  if (
    (isIso8601String(valA) && isUnixTimestampNumber(valB)) ||
    (isUnixTimestampNumber(valA) && isIso8601String(valB))
  ) {
    const strVal = isIso8601String(valA) ? valA : (valB as string);
    const numVal = typeof valA === "number" ? valA : (valB as number);
    const unit = numVal > 10_000_000_000 ? "milliseconds" : "seconds";

    return {
      category: "DATETIME_FORMAT_MISMATCH",
      severity: "critical",
      message:
        `Date/Time representation mismatch at '${path}': ` +
        `${sdkA} sent '${valA}' but ${sdkB} sent '${valB}' ` +
        `(ISO-8601 string vs Unix epoch integer in ${unit})`,
    };
  }

  // 2. Date-only String vs Unix Epoch Number (e.g. "2024-01-15" vs 1705276800)
  if (
    (isDateOnlyString(valA) && isUnixTimestampNumber(valB)) ||
    (isUnixTimestampNumber(valA) && isDateOnlyString(valB))
  ) {
    return {
      category: "DATETIME_FORMAT_MISMATCH",
      severity: "critical",
      message:
        `Date representation mismatch at '${path}': ` +
        `${sdkA} sent '${valA}' but ${sdkB} sent '${valB}' (Date string vs Unix epoch number)`,
    };
  }

  // 3. String numeric epoch vs ISO-8601 string (e.g. "1705320000" vs "2024-01-15T12:00:00Z")
  if (typeof valA === "string" && typeof valB === "string") {
    const isNumA = /^\d{9,13}$/.test(valA.trim());
    const isNumB = /^\d{9,13}$/.test(valB.trim());

    if ((isIso8601String(valA) && isNumB) || (isNumA && isIso8601String(valB))) {
      return {
        category: "DATETIME_FORMAT_MISMATCH",
        severity: "critical",
        message:
          `Date/Time representation mismatch at '${path}': ` +
          `${sdkA} sent '${valA}' but ${sdkB} sent '${valB}' (ISO-8601 string vs numeric epoch string)`,
      };
    }

    // 4. Date-only vs Full Date-time (e.g. "2024-01-15" vs "2024-01-15T00:00:00Z")
    if (
      (isDateOnlyString(valA) && isIso8601String(valB)) ||
      (isIso8601String(valA) && isDateOnlyString(valB))
    ) {
      return {
        category: "DATETIME_FORMAT_MISMATCH",
        severity: "warning",
        message:
          `Date precision truncation mismatch at '${path}': ` +
          `${sdkA} sent date-only '${valA}' but ${sdkB} sent date-time '${valB}'`,
      };
    }

    // 5. RFC-1123 / HTTP date string vs ISO-8601 string
    if (
      (isRfc1123DateString(valA) && isIso8601String(valB)) ||
      (isIso8601String(valA) && isRfc1123DateString(valB))
    ) {
      return {
        category: "DATETIME_FORMAT_MISMATCH",
        severity: "critical",
        message:
          `Date/Time standard divergence at '${path}': ` +
          `${sdkA} sent '${valA}' (RFC-1123) but ${sdkB} sent '${valB}' (ISO-8601)`,
      };
    }

    // 6. ISO-8601 Variations (millisecond precision, timezone offsets representing same instant)
    if (isIso8601String(valA) && isIso8601String(valB)) {
      const dateA = new Date(valA);
      const dateB = new Date(valB);

      if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
        if (dateA.getTime() === dateB.getTime()) {
          // Same timestamp instant, but different string formatting (e.g. .000Z vs Z, or +00:00 vs Z)
          return {
            category: "DATETIME_FORMAT_MISMATCH",
            severity: "warning",
            message:
              `ISO-8601 formatting variation at '${path}': ` +
              `'${valA}' vs '${valB}' (both represent identical timestamp ${dateA.toISOString()})`,
          };
        } else {
          return {
            category: "DATETIME_FORMAT_MISMATCH",
            severity: "critical",
            message:
              `Date/Time value mismatch at '${path}': '${valA}' vs '${valB}'`,
          };
        }
      }
    }
  }

  // 7. Numeric timestamps (seconds vs milliseconds e.g. 1705320000 vs 1705320000000)
  if (
    typeof valA === "number" &&
    typeof valB === "number" &&
    Number.isInteger(valA) &&
    Number.isInteger(valB)
  ) {
    if (valA * 1000 === valB || valB * 1000 === valA) {
      return {
        category: "DATETIME_FORMAT_MISMATCH",
        severity: "critical",
        message:
          `Timestamp unit mismatch at '${path}': ` +
          `${sdkA} sent ${valA} (${valA > valB ? "milliseconds" : "seconds"}), ` +
          `but ${sdkB} sent ${valB} (${valB > valA ? "milliseconds" : "seconds"})`,
      };
    }
  }

  return null;
}

// ─── ENUM_SERIALIZATION_ERROR Classifier ─────────────────────────────────────

/**
 * Classifies enum serialization discrepancies between two SDK outputs:
 *  - Ordinal integer (0, 1, 2) vs string name ("available", "pending")
 *  - Enum variant casing mismatch ("PLACED" vs "placed", "Pending" vs "pending")
 *  - Type-prefixed enum strings ("StatusAvailable" vs "available", "PET_STATUS_AVAILABLE" vs "available")
 *
 * @param path          - Property path string (e.g. "body.status")
 * @param valA          - Value from SDK A
 * @param valB          - Value from SDK B
 * @param allowedValues - Optional declared enum variants from schema
 * @param sdkA          - Label for SDK A
 * @param sdkB          - Label for SDK B
 * @returns ClassificationResult if an enum divergence is found, null otherwise
 */
export function classifyEnumDivergence(
  path: string,
  valA: unknown,
  valB: unknown,
  allowedValues?: (string | number)[],
  sdkA = "SDK A",
  sdkB = "SDK B"
): ClassificationResult | null {
  if (valA === undefined || valB === undefined || valA === null || valB === null) {
    return null;
  }

  if (valA === valB) {
    return null;
  }

  // 1. Ordinal Integer vs String Enum Name (e.g. 0 vs "available", or 1 vs "pending")
  if (
    (typeof valA === "number" && typeof valB === "string") ||
    (typeof valA === "string" && typeof valB === "number")
  ) {
    const numVal = typeof valA === "number" ? valA : (valB as number);
    const strVal = typeof valA === "string" ? valA : (valB as string);

    // If allowedValues is provided, check if numVal is an ordinal index
    let ordinalContext = "";
    if (allowedValues && allowedValues.length > 0) {
      if (numVal >= 0 && numVal < allowedValues.length) {
        const expectedVariant = allowedValues[numVal];
        ordinalContext = ` (ordinal index ${numVal} maps to declared variant '${expectedVariant}')`;
      }
    }

    if (Number.isInteger(numVal) && numVal >= 0 && numVal <= 100) {
      return {
        category: "ENUM_SERIALIZATION_ERROR",
        severity: "critical",
        message:
          `Enum ordinal serialization divergence at '${path}': ` +
          `${sdkA} sent ${JSON.stringify(valA)} but ${sdkB} sent ${JSON.stringify(valB)}` +
          `${ordinalContext}`,
      };
    }
  }

  // 2. String numeric ordinal vs string enum name (e.g. "0" vs "available")
  if (typeof valA === "string" && typeof valB === "string") {
    const isNumA = /^\d+$/.test(valA.trim());
    const isNumB = /^\d+$/.test(valB.trim());

    if ((isNumA && !isNumB) || (!isNumA && isNumB)) {
      return {
        category: "ENUM_SERIALIZATION_ERROR",
        severity: "critical",
        message:
          `Enum ordinal string serialization divergence at '${path}': ` +
          `${sdkA} sent '${valA}' but ${sdkB} sent '${valB}'`,
      };
    }

    // 3. Enum Casing Divergence (e.g. "PLACED" vs "placed", "Available" vs "available")
    if (valA.toLowerCase() === valB.toLowerCase()) {
      return {
        category: "ENUM_SERIALIZATION_ERROR",
        severity: "critical",
        message:
          `Enum variant casing divergence at '${path}': ` +
          `${sdkA} sent '${valA}' but ${sdkB} sent '${valB}'`,
      };
    }

    // 4. Type-prefixed enum variants (e.g. "StatusAvailable" vs "available", "PET_STATUS_AVAILABLE" vs "available")
    const normA = valA.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normB = valB.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (normA.endsWith(normB) || normB.endsWith(normA)) {
      return {
        category: "ENUM_SERIALIZATION_ERROR",
        severity: "critical",
        message:
          `Enum type-prefixed serialization divergence at '${path}': ` +
          `${sdkA} sent '${valA}' but ${sdkB} sent '${valB}'`,
      };
    }
  }

  return null;
}

// ─── Composite Body-Field Scanner ─────────────────────────────────────────────

export interface DateTimeAndEnumScanResult {
  dateTimeDiffs: Array<{ path: string; result: ClassificationResult }>;
  enumDiffs: Array<{ path: string; result: ClassificationResult }>;
}

/**
 * Recursively scans two decoded JSON body objects, collecting DATETIME_FORMAT_MISMATCH
 * and ENUM_SERIALIZATION_ERROR divergences at every nested key.
 *
 * @param objA - Parsed JSON body from SDK A
 * @param objB - Parsed JSON body from SDK B
 * @param path - Current JSON pointer path (start with "body")
 * @param sdkA - Label for SDK A
 * @param sdkB - Label for SDK B
 * @param out  - Accumulator (mutated in place)
 */
export function scanBodyForDateTimeAndEnumDivergences(
  objA: unknown,
  objB: unknown,
  path = "body",
  sdkA = "SDK A",
  sdkB = "SDK B",
  out: DateTimeAndEnumScanResult = { dateTimeDiffs: [], enumDiffs: [] }
): DateTimeAndEnumScanResult {
  if (objA === objB || objA === undefined || objB === undefined || objA === null || objB === null) {
    return out;
  }

  // Check scalar / primitive datetime mismatch
  const dtRes = classifyDateTimeDivergence(path, objA, objB, sdkA, sdkB);
  if (dtRes) {
    out.dateTimeDiffs.push({ path, result: dtRes });
    return out;
  }

  // Check scalar enum mismatch
  const enumRes = classifyEnumDivergence(path, objA, objB, undefined, sdkA, sdkB);
  if (enumRes) {
    out.enumDiffs.push({ path, result: enumRes });
    return out;
  }

  // Recurse into objects
  if (
    typeof objA === "object" &&
    objA !== null &&
    typeof objB === "object" &&
    objB !== null &&
    !Array.isArray(objA) &&
    !Array.isArray(objB)
  ) {
    const recA = objA as Record<string, unknown>;
    const recB = objB as Record<string, unknown>;
    const allKeys = Array.from(new Set([...Object.keys(recA), ...Object.keys(recB)]));

    for (const key of allKeys) {
      if (Object.prototype.hasOwnProperty.call(recA, key) && Object.prototype.hasOwnProperty.call(recB, key)) {
        scanBodyForDateTimeAndEnumDivergences(
          recA[key],
          recB[key],
          `${path}.${key}`,
          sdkA,
          sdkB,
          out
        );
      }
    }
    return out;
  }

  // Recurse into arrays
  if (Array.isArray(objA) && Array.isArray(objB)) {
    const maxLen = Math.max(objA.length, objB.length);
    for (let i = 0; i < maxLen; i++) {
      scanBodyForDateTimeAndEnumDivergences(
        objA[i],
        objB[i],
        `${path}[${i}]`,
        sdkA,
        sdkB,
        out
      );
    }
    return out;
  }

  return out;
}
