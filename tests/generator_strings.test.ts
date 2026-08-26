/**
 * Step 6.2: String & Documented Regex Subset Arbitraries — Unit Tests
 *
 * Verifies:
 *   1. stringArbitrary respects minLength / maxLength constraints
 *   2. UNICODE_CORNER_CASES are sampled when within length bounds
 *   3. Format-specific arbitraries produce structurally valid values
 *   4. isSafePattern correctly gates the documented safe subset
 *   5. patternArbitrary produces values matching the requested regex
 *   6. irStringArbitrary dispatches correctly for enum, pattern, format, default
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  stringArbitrary,
  UNICODE_CORNER_CASES,
  emailArbitrary,
  uuidArbitrary,
  uriArbitrary,
  dateArbitrary,
  dateTimeArbitrary,
  hostnameArbitrary,
  ipv4Arbitrary,
  ipv6Arbitrary,
  opaqueStringArbitrary,
  isSafePattern,
  patternArbitrary,
  irStringArbitrary,
} from "../src/generator/arbitraries/strings.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function samples<T>(arb: fc.Arbitrary<T>, n = 50, seed = 42): T[] {
  return fc.sample(arb, { numRuns: n, seed });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Step 6.2: String Arbitraries", () => {

  describe("stringArbitrary", () => {
    it("always produces strings within the requested minLength / maxLength bounds", () => {
      fc.assert(
        fc.property(
          stringArbitrary({ minLength: 3, maxLength: 10 }),
          (s) => s.length >= 3 && s.length <= 10
        ),
        { numRuns: 500, seed: 1 }
      );
    });

    it("produces empty strings when minLength is 0", () => {
      const values = samples(stringArbitrary({ minLength: 0, maxLength: 5 }), 200);
      expect(values.some((s) => s.length === 0)).toBe(true);
    });

    it("produces corner-case strings when they fit within bounds", () => {
      // A single space (length 1) should appear across 500 samples with min=0,max=20
      const values = samples(stringArbitrary({ minLength: 0, maxLength: 20 }), 500);
      // At least one UNICODE_CORNER_CASES entry should be present in the sample
      const set = new Set(values);
      const found = UNICODE_CORNER_CASES.filter((c) => c.length <= 20).some((c) => set.has(c));
      expect(found).toBe(true);
    });

    it("filters out corner cases that exceed maxLength", () => {
      // 255 char string should not appear when maxLength is 10
      const values = samples(stringArbitrary({ minLength: 0, maxLength: 10 }), 500);
      const longCase = "a".repeat(255);
      expect(values.includes(longCase)).toBe(false);
    });
  });

  describe("Format arbitraries — structural validity", () => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

    it("emailArbitrary always produces valid email shapes", () => {
      fc.assert(
        fc.property(emailArbitrary, (s) => EMAIL_RE.test(s)),
        { numRuns: 100, seed: 2 }
      );
    });

    it("uuidArbitrary always produces RFC-4122 UUID shapes", () => {
      fc.assert(
        fc.property(uuidArbitrary, (s) => UUID_RE.test(s)),
        { numRuns: 100, seed: 3 }
      );
    });

    it("uriArbitrary always produces strings starting with http:// or https://", () => {
      fc.assert(
        fc.property(uriArbitrary, (s) => s.startsWith("http://") || s.startsWith("https://")),
        { numRuns: 100, seed: 4 }
      );
    });

    it("dateArbitrary always produces YYYY-MM-DD strings", () => {
      fc.assert(
        fc.property(dateArbitrary, (s) => DATE_RE.test(s)),
        { numRuns: 100, seed: 5 }
      );
    });

    it("dateTimeArbitrary always produces ISO-8601 date-time strings", () => {
      fc.assert(
        fc.property(dateTimeArbitrary, (s) => DATETIME_RE.test(s)),
        { numRuns: 100, seed: 6 }
      );
    });

    it("ipv4Arbitrary always produces dotted-decimal shapes", () => {
      fc.assert(
        fc.property(ipv4Arbitrary, (s) => IPV4_RE.test(s)),
        { numRuns: 100, seed: 7 }
      );
    });

    it("ipv6Arbitrary always produces non-empty strings", () => {
      fc.assert(
        fc.property(ipv6Arbitrary, (s) => s.length > 0),
        { numRuns: 100, seed: 8 }
      );
    });

    it("hostnameArbitrary always produces non-empty strings", () => {
      fc.assert(
        fc.property(hostnameArbitrary, (s) => s.length > 0),
        { numRuns: 100, seed: 9 }
      );
    });

    it("opaqueStringArbitrary produces non-empty alphanumeric strings", () => {
      fc.assert(
        fc.property(opaqueStringArbitrary, (s) => /^[a-zA-Z0-9]+$/.test(s) && s.length >= 1),
        { numRuns: 100, seed: 10 }
      );
    });
  });

  describe("isSafePattern (Documented Regex Gate)", () => {
    it("accepts simple character class patterns", () => {
      expect(isSafePattern("[a-z]")).toBe(true);
      expect(isSafePattern("[A-Z]{3,8}")).toBe(true);
      expect(isSafePattern("[0-9]+")).toBe(true);
      expect(isSafePattern("[^@]+")).toBe(true);
    });

    it("accepts anchored patterns", () => {
      expect(isSafePattern("^[a-z]+$")).toBe(true);
      expect(isSafePattern("^[A-Z]{3}$")).toBe(true);
    });

    it("rejects alternation (|)", () => {
      expect(isSafePattern("foo|bar")).toBe(false);
      expect(isSafePattern("[a-z]+|[0-9]+")).toBe(false);
    });

    it("rejects lookahead / non-capturing groups", () => {
      expect(isSafePattern("(?=foo)")).toBe(false);
      expect(isSafePattern("(?:foo)")).toBe(false);
    });

    it("rejects backreferences", () => {
      expect(isSafePattern("(.)\\1")).toBe(false);
    });
  });

  describe("patternArbitrary (Safe Regex Subset)", () => {
    it("produces strings matching a simple lowercase letter pattern", () => {
      const arb = patternArbitrary("[a-z]{4}", {});
      fc.assert(
        fc.property(arb, (s) => /^[a-z]{4}$/.test(s)),
        { numRuns: 200, seed: 11 }
      );
    });

    it("produces strings matching a digit quantifier pattern", () => {
      const arb = patternArbitrary("[0-9]{3,6}", {});
      fc.assert(
        fc.property(arb, (s) => /^[0-9]{3,6}$/.test(s)),
        { numRuns: 200, seed: 12 }
      );
    });

    it("handles anchored patterns by stripping ^ and $", () => {
      const arb = patternArbitrary("^[A-Z]{2}$", {});
      fc.assert(
        fc.property(arb, (s) => /^[A-Z]{2}$/.test(s)),
        { numRuns: 200, seed: 13 }
      );
    });

    it("falls back to stringArbitrary for unsafe patterns (alternation)", () => {
      // Should not throw — produces some string
      const arb = patternArbitrary("foo|bar", { minLength: 0, maxLength: 20 });
      const values = samples(arb, 10);
      expect(values.every((s) => typeof s === "string")).toBe(true);
    });
  });

  describe("irStringArbitrary (Dispatcher)", () => {
    it("dispatches to enum values only", () => {
      const arb = irStringArbitrary({ type: "string", enum: ["alpha", "beta", "gamma"] });
      fc.assert(
        fc.property(arb, (s) => ["alpha", "beta", "gamma"].includes(s)),
        { numRuns: 200, seed: 14 }
      );
    });

    it("dispatches to pattern arbitrary for schemas with a safe pattern", () => {
      const arb = irStringArbitrary({ type: "string", pattern: "[a-z]{3}" });
      fc.assert(
        fc.property(arb, (s) => /^[a-z]{3}$/.test(s)),
        { numRuns: 200, seed: 15 }
      );
    });

    it("dispatches to uuid format", () => {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const arb = irStringArbitrary({ type: "string", format: "uuid" });
      fc.assert(
        fc.property(arb, (s) => UUID_RE.test(s)),
        { numRuns: 100, seed: 16 }
      );
    });

    it("dispatches to date format", () => {
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const arb = irStringArbitrary({ type: "string", format: "date" });
      fc.assert(
        fc.property(arb, (s) => DATE_RE.test(s)),
        { numRuns: 100, seed: 17 }
      );
    });

    it("dispatches to date-time format", () => {
      const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      const arb = irStringArbitrary({ type: "string", format: "date-time" });
      fc.assert(
        fc.property(arb, (s) => DATETIME_RE.test(s)),
        { numRuns: 100, seed: 18 }
      );
    });

    it("dispatches to email format", () => {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const arb = irStringArbitrary({ type: "string", format: "email" });
      fc.assert(
        fc.property(arb, (s) => EMAIL_RE.test(s)),
        { numRuns: 100, seed: 19 }
      );
    });

    it("respects minLength and maxLength in default dispatch", () => {
      const arb = irStringArbitrary({ type: "string", minLength: 5, maxLength: 15 });
      fc.assert(
        fc.property(arb, (s) => s.length >= 5 && s.length <= 15),
        { numRuns: 300, seed: 20 }
      );
    });

    it("produces a string for unknown formats (falls through to default)", () => {
      const arb = irStringArbitrary({ type: "string", format: "custom-unknown" as any });
      fc.assert(
        fc.property(arb, (s) => typeof s === "string"),
        { numRuns: 50, seed: 21 }
      );
    });
  });
});
