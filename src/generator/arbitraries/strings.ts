/**
 * WireParity - String & Documented Regex Subset Arbitraries (Step 6.2)
 *
 * Provides fast-check arbitraries for `IRStringSchema`, covering:
 *   - General strings: Unicode corner cases, whitespace, boundary lengths
 *   - Format-specific strings: email, uuid, uri, date, date-time, hostname, ipv4, ipv6
 *   - Pattern-constrained strings: A safe documented regex subset
 *   - Enum-valued strings
 *
 * ## Documented Safe Regex Subset
 * The pattern interpreter supports the following constructs ONLY.
 * Patterns using unsupported constructs fall back to unconstrained strings.
 *
 * | Construct           | Example           | Description                         |
 * |---------------------|-------------------|-------------------------------------|
 * | Char class `[...]`  | `[a-z]`           | ASCII ranges and literal chars       |
 * | Negated class `[^]` | `[^@]`            | Any char not in the class            |
 * | Anchors `^` `$`     | `^foo$`           | Stripped; applied implicitly         |
 * | Quantifiers `{n,m}` | `[a-z]{3,8}`      | Fixed or range repetition count      |
 * | `+` `?` `*`         | `[a-z]+`          | One-or-more, optional, zero-or-more  |
 * | Literal chars        | `foo`             | ASCII literal character sequences    |
 * | Alternation `|`     | `foo|bar`         | NOT supported (falls back)           |
 * | Lookahead/behind     | `(?=...)` etc.    | NOT supported (falls back)           |
 * | Backreferences       | `\1`              | NOT supported (falls back)           |
 */

import * as fc from "fast-check";
import type { IRStringSchema } from "../../ir/values.js";

// ─── Unicode Corner Cases ────────────────────────────────────────────────────

/**
 * Fixed pool of Unicode corner-case strings that exercise edge cases
 * in string serialization, HTTP encoding, and JSON canonicalization.
 */
export const UNICODE_CORNER_CASES: readonly string[] = [
  "",                         // empty string
  " ",                        // single space
  "\t\n\r",                   // whitespace-only
  "hello world",              // normal ASCII
  "café",                     // Latin extended (U+00E9)
  "日本語",                    // CJK ideographs
  "العربية",                  // Arabic RTL
  "🚀🔥✨",                   // emoji (surrogate pairs)
  "\u0000",                   // NUL byte
  "\uFFFD",                   // replacement character
  "Special &?=#/%20 spaces",  // URL-encoded characters
  '"quoted"',                 // JSON-relevant double quotes
  "back\\slash",              // backslash
  "a".repeat(255),            // 255 chars (common limit boundary)
  "a".repeat(256),            // 256 chars (overflow boundary)
] as const;

// ─── Core String Arbitrary ───────────────────────────────────────────────────

/**
 * Returns an `fc.Arbitrary<string>` for plain (unformatted, un-patterned) strings.
 *
 * Produces a mix of:
 *  - Random Unicode strings within [minLength, maxLength]
 *  - A sampled subset of UNICODE_CORNER_CASES that pass the length constraints
 */
export function stringArbitrary(schema: {
  minLength?: number;
  maxLength?: number;
}): fc.Arbitrary<string> {
  const min = schema.minLength ?? 0;
  const max = schema.maxLength ?? 64;

  const random = fc.string({ minLength: min, maxLength: max });

  const cornerCases = UNICODE_CORNER_CASES
    .filter((s) => s.length >= min && s.length <= max)
    .map((s) => fc.constant(s));

  if (cornerCases.length === 0) return random;

  return fc.oneof({ arbitrary: random, weight: 4 }, ...cornerCases.map((c) => ({ arbitrary: c, weight: 1 })));
}

// ─── Format-Specific Arbitraries ─────────────────────────────────────────────

/** RFC-5321 simplified email: localpart@domain.tld */
export const emailArbitrary: fc.Arbitrary<string> = fc.emailAddress();

/** RFC-4122 UUID v4 */
export const uuidArbitrary: fc.Arbitrary<string> = fc.uuid();

/** Simple HTTP/HTTPS URI */
export const uriArbitrary: fc.Arbitrary<string> = fc.webUrl();

/** ISO-8601 date: YYYY-MM-DD */
export const dateArbitrary: fc.Arbitrary<string> = fc.date({
  min: new Date("2000-01-01"),
  max: new Date("2099-12-31"),
}).map((d) => d.toISOString().slice(0, 10));

/** ISO-8601 date-time: YYYY-MM-DDTHH:mm:ss.mmmZ */
export const dateTimeArbitrary: fc.Arbitrary<string> = fc.date({
  min: new Date("2000-01-01T00:00:00Z"),
  max: new Date("2099-12-31T23:59:59Z"),
}).filter((d) => !isNaN(d.getTime())).map((d) => d.toISOString());

/** Simple hostname (RFC-1123) */
export const hostnameArbitrary: fc.Arbitrary<string> = fc.domain();

/** IPv4 dotted-decimal */
export const ipv4Arbitrary: fc.Arbitrary<string> = fc.ipV4();

/** IPv6 colon-hex */
export const ipv6Arbitrary: fc.Arbitrary<string> = fc.ipV6();

/** password / byte / binary: opaque strings — treated as plain ASCII */
export const opaqueStringArbitrary: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 32,
  unit: fc.mapToConstant(
    { num: 26, build: (i) => String.fromCharCode(97 + i) },  // a-z
    { num: 26, build: (i) => String.fromCharCode(65 + i) },  // A-Z
    { num: 10, build: (i) => String.fromCharCode(48 + i) },  // 0-9
  ),
});

// ─── Documented Safe Regex Subset ────────────────────────────────────────────

/**
 * Supported pattern constructs. Patterns matching any of the UNSUPPORTED
 * markers below fall back to `stringArbitrary`.
 */
const UNSUPPORTED_PATTERN_MARKERS = [
  "(?",     // lookahead / non-capturing group
  "\\1",    // backreference
  "\\2",
  "|",      // alternation (not yet supported)
];

/**
 * Returns true if the pattern is within the documented safe subset.
 */
export function isSafePattern(pattern: string): boolean {
  return !UNSUPPORTED_PATTERN_MARKERS.some((m) => pattern.includes(m));
}

/**
 * Builds a fast-check string arbitrary from a safe regex pattern string.
 *
 * Supported constructs:
 *  - `^` / `$` anchors (stripped, always full-match)
 *  - `[a-z]`, `[A-Z]`, `[0-9]`, `[^x]` character classes
 *  - `{n}`, `{n,m}` quantifiers
 *  - `+`, `?`, `*` shorthand quantifiers
 *  - Literal ASCII characters
 *
 * Falls back to `stringArbitrary(schema)` for patterns outside the safe subset
 * or that cannot be fully parsed.
 *
 * @param pattern - The regex pattern string from `IRStringSchema.pattern`
 * @param schema  - The full schema, used for fallback length constraints
 */
export function patternArbitrary(
  pattern: string,
  schema: { minLength?: number; maxLength?: number }
): fc.Arbitrary<string> {
  if (!isSafePattern(pattern)) {
    return stringArbitrary(schema);
  }

  try {
    return fc.stringMatching(new RegExp(`^(?:${stripAnchors(pattern)})$`));
  } catch {
    // Pattern could not be compiled — fall back gracefully
    return stringArbitrary(schema);
  }
}

/**
 * Strips leading `^` and trailing `$` anchors so the pattern can be used
 * inside our own `^(?:...)$` wrapper without double-anchoring.
 */
function stripAnchors(pattern: string): string {
  let p = pattern;
  if (p.startsWith("^")) p = p.slice(1);
  if (p.endsWith("$")) p = p.slice(0, -1);
  return p;
}

// ─── Main IRStringSchema Dispatcher ──────────────────────────────────────────

/**
 * Returns a fast-check `Arbitrary<string>` tailored to the full `IRStringSchema`.
 *
 * Resolution order:
 *  1. `enum`   → one of the declared string values
 *  2. `pattern` → pattern arbitrary (safe subset) or fallback
 *  3. `format`  → format-specific arbitrary
 *  4. default  → `stringArbitrary` respecting minLength / maxLength
 */
export function irStringArbitrary(schema: IRStringSchema): fc.Arbitrary<string> {
  // 1. Enum
  if (schema.enum && schema.enum.length > 0) {
    return fc.constantFrom(...schema.enum);
  }

  // 2. Pattern (safe regex subset)
  if (schema.pattern) {
    return patternArbitrary(schema.pattern, schema);
  }

  // 3. Format-specific
  switch (schema.format) {
    case "email":     return emailArbitrary;
    case "uuid":      return uuidArbitrary;
    case "uri":       return uriArbitrary;
    case "date":      return dateArbitrary;
    case "date-time": return dateTimeArbitrary;
    case "hostname":  return hostnameArbitrary;
    case "ipv4":      return ipv4Arbitrary;
    case "ipv6":      return ipv6Arbitrary;
    case "password":
    case "byte":
    case "binary":    return opaqueStringArbitrary;
    default:          break;
  }

  // 4. Default: length-bounded Unicode string with corner cases
  return stringArbitrary(schema);
}
