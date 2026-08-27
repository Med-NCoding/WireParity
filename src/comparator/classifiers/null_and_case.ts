/**
 * WireParity - OPTIONAL_VS_NULL & Case Leak Classifier (Step 7.1)
 *
 * Provides focused classification functions for two related divergence categories:
 *
 *   1. OPTIONAL_VS_NULL  - One SDK omits a key entirely (undefined) while another
 *                          sends it with an explicit JSON `null` value.
 *
 *   2. CASE_CONVENTION_LEAK - One SDK serialises a key or string value using one
 *                             casing convention (e.g. camelCase) while another
 *                             uses a different one (snake_case, PascalCase, etc.).
 *
 * Each function returns a typed ClassificationResult or `null` when the pattern
 * does not apply, allowing classifiers to be composed in a chain without
 * branching at the call site.
 */

import type { DivergenceCategory, DiffSeverity } from "../types.js";

// ─── Shared Result Type ───────────────────────────────────────────────────────

export interface ClassificationResult {
  category: DivergenceCategory;
  severity: DiffSeverity;
  message: string;
}

// ─── OPTIONAL_VS_NULL Classifier ─────────────────────────────────────────────

/**
 * Detects the OPTIONAL_VS_NULL pattern:
 *  - valA is `undefined` (key absent from object) and valB is `null` (key explicitly sent as null)
 *  - Or vice-versa: valA is `null` and valB is `undefined`
 *
 * This catches the canonical SDK divergence where one generator omits nullable
 * optional fields while another serialises them as `null`.
 *
 * @param path - JSON pointer path to the field (e.g. "body.user.nickname")
 * @param valA - Value from SDK A (may be undefined when the key is absent)
 * @param valB - Value from SDK B (may be undefined when the key is absent)
 * @returns ClassificationResult if the pattern matches, null otherwise
 */
export function classifyOptionalVsNull(
  path: string,
  valA: unknown,
  valB: unknown
): ClassificationResult | null {
  if (valA === undefined && valB === null) {
    return {
      category: "OPTIONAL_VS_NULL",
      severity: "warning",
      message: `Field '${path}' is omitted by SDK A but explicitly sent as null by SDK B`,
    };
  }

  if (valA === null && valB === undefined) {
    return {
      category: "OPTIONAL_VS_NULL",
      severity: "warning",
      message: `Field '${path}' is explicitly sent as null by SDK A but omitted by SDK B`,
    };
  }

  return null;
}

/**
 * Returns true when the pattern matches OPTIONAL_VS_NULL without allocating
 * a result object. Useful for fast pre-screening.
 */
export function isOptionalVsNull(valA: unknown, valB: unknown): boolean {
  return (
    (valA === undefined && valB === null) ||
    (valA === null && valB === undefined)
  );
}

// ─── Casing Convention Utilities ─────────────────────────────────────────────

/** Recognised casing conventions for classification labels. */
export type CasingConvention =
  | "camelCase"
  | "snake_case"
  | "PascalCase"
  | "SCREAMING_SNAKE_CASE"
  | "kebab-case"
  | "unknown";

/**
 * Identifies the dominant casing convention of a string identifier.
 * Heuristic rules applied in priority order:
 *  1. All-uppercase with underscores → SCREAMING_SNAKE_CASE
 *  2. Contains underscores and any lowercase → snake_case
 *  3. Contains hyphens → kebab-case
 *  4. Starts with uppercase and contains more uppercase chars → PascalCase
 *  5. Starts with lowercase and contains uppercase chars → camelCase
 *  6. Otherwise → unknown
 */
export function detectCasing(str: string): CasingConvention {
  if (str.length === 0) return "unknown";

  if (/^[A-Z][A-Z0-9_]*$/.test(str) && str.includes("_")) {
    return "SCREAMING_SNAKE_CASE";
  }

  if (str.includes("_")) {
    return "snake_case";
  }

  if (str.includes("-")) {
    return "kebab-case";
  }

  if (/^[A-Z]/.test(str) && /[A-Z]/.test(str.slice(1))) {
    return "PascalCase";
  }

  if (/^[a-z]/.test(str) && /[A-Z]/.test(str)) {
    return "camelCase";
  }

  return "unknown";
}

/**
 * Returns true when `str` follows camelCase (starts lowercase, contains uppercase).
 */
export function isCamelCase(str: string): boolean {
  return /^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(str);
}

/**
 * Returns true when `str` follows snake_case (all lowercase with underscores).
 */
export function isSnakeCase(str: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(str) && str.includes("_");
}

/**
 * Converts a camelCase identifier to its snake_case equivalent.
 * e.g. "petName" → "pet_name", "createdAt" → "created_at"
 */
export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Converts a snake_case identifier to its camelCase equivalent.
 * e.g. "pet_name" → "petName", "created_at" → "createdAt"
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Returns true when `a` and `b` are string identifiers that refer to the
 * same semantic word sequence but differ only in casing convention.
 *
 * Examples:
 *   "petName" vs "pet_name"   → true
 *   "createdAt" vs "created_at" → true
 *   "userId" vs "user_id"     → true
 *   "status" vs "STATUS"      → false (single-word, case mismatch treated separately)
 */
export function areSameCasingVariant(a: string, b: string): boolean {
  if (a === b) return false; // identical strings are not a divergence

  const aNorm = normaliseIdentifier(a);
  const bNorm = normaliseIdentifier(b);

  return aNorm === bNorm && aNorm.length > 0;
}

/**
 * Normalises an identifier by converting any casing convention to a lowercase
 * underscore-separated token list. Used for casing-invariant comparison.
 *
 * e.g. "petName" → "pet_name"
 *      "PetName" → "pet_name"
 *      "pet_name" → "pet_name"
 *      "pet-name" → "pet_name"
 *      "PET_NAME" → "pet_name"
 */
export function normaliseIdentifier(str: string): string {
  return str
    // Split PascalCase / camelCase word boundaries
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    // Replace hyphens with underscores
    .replace(/-/g, "_")
    .toLowerCase();
}

// ─── CASE_CONVENTION_LEAK Classifier ─────────────────────────────────────────

/**
 * Detects the CASE_CONVENTION_LEAK pattern for object key names.
 *
 * Fires when two key sets from SDK A and SDK B are "the same logical key" but
 * serialised with different casing conventions (e.g. `petName` vs `pet_name`).
 *
 * Note: this classifier operates on *key names* (strings), not on field values.
 * Call it when a key present in one object is absent in the other, and you want
 * to test whether the absent key is actually a casing variant of an existing key.
 *
 * @param path        - JSON pointer path prefix (e.g. "body")
 * @param missingKey  - Key present in one SDK but absent in the other
 * @param presentKeys - All keys from the other SDK's object
 * @param sdkWithKey  - Label for the SDK that has `missingKey`
 * @param sdkWithout  - Label for the SDK that uses different casing
 * @returns ClassificationResult if a casing variant is found, null otherwise
 */
export function classifyCaseLeakOnKey(
  path: string,
  missingKey: string,
  presentKeys: string[],
  sdkWithKey: string,
  sdkWithout: string
): ClassificationResult | null {
  const missingNorm = normaliseIdentifier(missingKey);

  for (const presentKey of presentKeys) {
    if (presentKey === missingKey) continue; // identical → not a case leak
    if (normaliseIdentifier(presentKey) === missingNorm) {
      const missingConvention = detectCasing(missingKey);
      const presentConvention = detectCasing(presentKey);
      return {
        category: "CASE_CONVENTION_LEAK",
        severity: "critical",
        message:
          `Case convention leak at '${path}': ` +
          `${sdkWithKey} uses '${missingKey}' (${missingConvention}) ` +
          `but ${sdkWithout} uses '${presentKey}' (${presentConvention})`,
      };
    }
  }

  return null;
}

/**
 * Detects the CASE_CONVENTION_LEAK pattern for string *values* (not keys).
 *
 * Fires when two string values are the same sequence of words but differ only
 * in casing convention. This catches enum serialisation casing leaks that are
 * not strict case-equality differences (e.g. `"available"` vs `"AVAILABLE"` is
 * caught by ENUM_SERIALIZATION_ERROR; this classifier targets multi-word values
 * like `"pet_name"` vs `"petName"`).
 *
 * @param path - JSON pointer path to the field
 * @param valA - String value from SDK A
 * @param valB - String value from SDK B
 * @returns ClassificationResult if the pattern matches, null otherwise
 */
export function classifyCaseLeakOnValue(
  path: string,
  valA: unknown,
  valB: unknown
): ClassificationResult | null {
  if (typeof valA !== "string" || typeof valB !== "string") return null;
  if (valA === valB) return null;

  if (!areSameCasingVariant(valA, valB)) return null;

  const conventionA = detectCasing(valA);
  const conventionB = detectCasing(valB);

  // Avoid misclassifying simple single-word case differences as casing leaks
  // (e.g. "Available" vs "available" — those are ENUM_SERIALIZATION_ERROR territory)
  if (conventionA === "unknown" && conventionB === "unknown") return null;

  return {
    category: "CASE_CONVENTION_LEAK",
    severity: "critical",
    message: `Case convention leak at value of '${path}': '${valA}' (${conventionA}) vs '${valB}' (${conventionB})`,
  };
}

// ─── Composite Body-Field Scanner ─────────────────────────────────────────────

export interface BodyFieldScanResult {
  optionalVsNullDiffs: Array<{ path: string; result: ClassificationResult }>;
  caseLeakDiffs: Array<{ path: string; result: ClassificationResult }>;
}

/**
 * Recursively scans two decoded JSON body objects, collecting OPTIONAL_VS_NULL
 * and CASE_CONVENTION_LEAK divergences at every nested key.
 *
 * @param objA    - Parsed JSON body from SDK A (object or primitive)
 * @param objB    - Parsed JSON body from SDK B (object or primitive)
 * @param path    - Current JSON pointer path (start with "body")
 * @param sdkA    - Label for SDK A
 * @param sdkB    - Label for SDK B
 * @param out     - Accumulator (mutated in place)
 */
export function scanBodyForNullAndCaseLeaks(
  objA: unknown,
  objB: unknown,
  path: string,
  sdkA: string,
  sdkB: string,
  out: BodyFieldScanResult = { optionalVsNullDiffs: [], caseLeakDiffs: [] }
): BodyFieldScanResult {
  // OPTIONAL_VS_NULL check at this level
  const ovn = classifyOptionalVsNull(path, objA, objB);
  if (ovn) {
    out.optionalVsNullDiffs.push({ path, result: ovn });
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
    const keysA = Object.keys(recA);
    const keysB = Object.keys(recB);
    const allKeys = Array.from(new Set([...keysA, ...keysB]));

    for (const key of allKeys) {
      const hasInA = Object.prototype.hasOwnProperty.call(recA, key);
      const hasInB = Object.prototype.hasOwnProperty.call(recB, key);

      if (hasInA && !hasInB) {
        // Key present in A but missing in B — check for casing variant
        const leak = classifyCaseLeakOnKey(`${path}.${key}`, key, keysB, sdkA, sdkB);
        if (leak) {
          out.caseLeakDiffs.push({ path: `${path}.${key}`, result: leak });
          continue;
        }
        // Otherwise check OPTIONAL_VS_NULL
        const ovnNested = classifyOptionalVsNull(`${path}.${key}`, recA[key], undefined);
        if (ovnNested) out.optionalVsNullDiffs.push({ path: `${path}.${key}`, result: ovnNested });
      } else if (!hasInA && hasInB) {
        // Key present in B but missing in A — check for casing variant
        const leak = classifyCaseLeakOnKey(`${path}.${key}`, key, keysA, sdkB, sdkA);
        if (leak) {
          out.caseLeakDiffs.push({ path: `${path}.${key}`, result: leak });
          continue;
        }
        const ovnNested = classifyOptionalVsNull(`${path}.${key}`, undefined, recB[key]);
        if (ovnNested) out.optionalVsNullDiffs.push({ path: `${path}.${key}`, result: ovnNested });
      } else {
        // Both have the key — check string value casing, then recurse
        const caseVal = classifyCaseLeakOnValue(`${path}.${key}`, recA[key], recB[key]);
        if (caseVal) {
          out.caseLeakDiffs.push({ path: `${path}.${key}`, result: caseVal });
        }
        scanBodyForNullAndCaseLeaks(recA[key], recB[key], `${path}.${key}`, sdkA, sdkB, out);
      }
    }
    return out;
  }

  // Recurse into arrays
  if (Array.isArray(objA) && Array.isArray(objB)) {
    const maxLen = Math.max(objA.length, objB.length);
    for (let i = 0; i < maxLen; i++) {
      scanBodyForNullAndCaseLeaks(objA[i], objB[i], `${path}[${i}]`, sdkA, sdkB, out);
    }
    return out;
  }

  return out;
}
