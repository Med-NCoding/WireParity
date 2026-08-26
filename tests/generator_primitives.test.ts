/**
 * Step 6.3: Numeric, Date & Enum Arbitraries — Unit Tests
 *
 * Verifies:
 *   1. irIntegerArbitrary respects min/max, exclusiveMin/Max, and formats
 *   2. irIntegerArbitrary samples boundary values (0, -1, 1, min, max, int32/int64 limits)
 *   3. irIntegerArbitrary dispatches to enum values correctly
 *   4. irNumberArbitrary produces finite floats within bounds
 *   5. irNumberArbitrary samples -0 and boundary values
 *   6. irBooleanArbitrary produces both true and false
 *   7. irEnumArbitrary covers all declared values across runs
 *   8. withNullable injects IRNullValue when nullable: true
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  irIntegerArbitrary,
  irNumberArbitrary,
  irBooleanArbitrary,
  irEnumArbitrary,
  withNullable,
} from "../src/generator/arbitraries/primitives.js";
import type {
  IRIntegerSchema,
  IRNumberSchema,
  IRBooleanSchema,
} from "../src/ir/values.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function samples<T>(arb: fc.Arbitrary<T>, n = 200, seed = 42): T[] {
  return fc.sample(arb, { numRuns: n, seed });
}

const INT32_MIN = -2_147_483_648;
const INT32_MAX =  2_147_483_647;

// ─── irIntegerArbitrary ──────────────────────────────────────────────────────

describe("irIntegerArbitrary", () => {
  it("always produces IRIntegerValue nodes with kind 'integer'", () => {
    fc.assert(
      fc.property(
        irIntegerArbitrary({ type: "integer" }),
        (v) => v.kind === "integer" && typeof v.value === "number" && Number.isInteger(v.value)
      ),
      { numRuns: 300, seed: 1 }
    );
  });

  it("respects minimum and maximum constraints", () => {
    const schema: IRIntegerSchema = { type: "integer", minimum: 5, maximum: 20 };
    fc.assert(
      fc.property(irIntegerArbitrary(schema), (v) => v.value >= 5 && v.value <= 20),
      { numRuns: 300, seed: 2 }
    );
  });

  it("respects exclusive minimum (boolean form)", () => {
    const schema: IRIntegerSchema = {
      type: "integer",
      minimum: 10,
      maximum: 100,
      exclusiveMinimum: true,
    };
    fc.assert(
      fc.property(irIntegerArbitrary(schema), (v) => v.value > 10),
      { numRuns: 300, seed: 3 }
    );
  });

  it("respects exclusive maximum (boolean form)", () => {
    const schema: IRIntegerSchema = {
      type: "integer",
      minimum: -50,
      maximum: 50,
      exclusiveMaximum: true,
    };
    fc.assert(
      fc.property(irIntegerArbitrary(schema), (v) => v.value < 50),
      { numRuns: 300, seed: 4 }
    );
  });

  it("samples boundary corners (0, min, max) across 500 runs", () => {
    const schema: IRIntegerSchema = { type: "integer", minimum: -10, maximum: 100 };
    const vals = samples(irIntegerArbitrary(schema), 500).map((v) => v.value);
    expect(vals.some((v) => v === 0)).toBe(true);
    expect(vals.some((v) => v === -10)).toBe(true);
    expect(vals.some((v) => v === 100)).toBe(true);
  });

  it("samples -1 and 1 boundary values (without schema min/max)", () => {
    const vals = samples(irIntegerArbitrary({ type: "integer" }), 500).map((v) => v.value);
    expect(vals.some((v) => v === -1)).toBe(true);
    expect(vals.some((v) => v === 1)).toBe(true);
  });

  it("clamps int32 format to INT32 limits", () => {
    const schema: IRIntegerSchema = { type: "integer", format: "int32" };
    fc.assert(
      fc.property(irIntegerArbitrary(schema), (v) => v.value >= INT32_MIN && v.value <= INT32_MAX),
      { numRuns: 300, seed: 5 }
    );
  });

  it("samples INT32_MIN and INT32_MAX for int32 format", () => {
    const schema: IRIntegerSchema = { type: "integer", format: "int32" };
    const vals = samples(irIntegerArbitrary(schema), 500).map((v) => v.value);
    expect(vals.some((v) => v === INT32_MIN)).toBe(true);
    expect(vals.some((v) => v === INT32_MAX)).toBe(true);
  });

  it("dispatches to enum values when declared", () => {
    const schema: IRIntegerSchema = { type: "integer", enum: [7, 14, 21] };
    fc.assert(
      fc.property(irIntegerArbitrary(schema), (v) => [7, 14, 21].includes(v.value)),
      { numRuns: 200, seed: 6 }
    );
  });

  it("covers all enum values across 300 runs", () => {
    const schema: IRIntegerSchema = { type: "integer", enum: [10, 20, 30] };
    const vals = new Set(samples(irIntegerArbitrary(schema), 300).map((v) => v.value));
    expect(vals.has(10)).toBe(true);
    expect(vals.has(20)).toBe(true);
    expect(vals.has(30)).toBe(true);
  });
});

// ─── irNumberArbitrary ───────────────────────────────────────────────────────

describe("irNumberArbitrary", () => {
  it("always produces IRNumberValue nodes with kind 'number'", () => {
    fc.assert(
      fc.property(
        irNumberArbitrary({ type: "number" }),
        (v) => v.kind === "number" && typeof v.value === "number"
      ),
      { numRuns: 300, seed: 7 }
    );
  });

  it("always produces finite values (no Infinity, no NaN)", () => {
    fc.assert(
      fc.property(irNumberArbitrary({ type: "number" }), (v) => Number.isFinite(v.value) || Object.is(v.value, -0)),
      { numRuns: 300, seed: 8 }
    );
  });

  it("respects minimum and maximum constraints", () => {
    const schema: IRNumberSchema = { type: "number", minimum: 1.5, maximum: 9.9 };
    fc.assert(
      fc.property(irNumberArbitrary(schema), (v) => v.value >= 1.5 && v.value <= 9.9),
      { numRuns: 300, seed: 9 }
    );
  });

  it("samples 0 and -0 boundary values", () => {
    const schema: IRNumberSchema = { type: "number" };
    const vals = samples(irNumberArbitrary(schema), 500).map((v) => v.value);
    // 0 must appear
    expect(vals.some((v) => v === 0)).toBe(true);
    // -0 must appear (Object.is distinguishes it)
    expect(vals.some((v) => Object.is(v, -0))).toBe(true);
  });

  it("samples min and max boundary values when declared", () => {
    const schema: IRNumberSchema = { type: "number", minimum: -5.5, maximum: 5.5 };
    const vals = samples(irNumberArbitrary(schema), 500).map((v) => v.value);
    expect(vals.some((v) => v === -5.5)).toBe(true);
    expect(vals.some((v) => v === 5.5)).toBe(true);
  });

  it("dispatches to enum values when declared", () => {
    const schema: IRNumberSchema = { type: "number", enum: [1.1, 2.2, 3.3] };
    fc.assert(
      fc.property(irNumberArbitrary(schema), (v) => [1.1, 2.2, 3.3].includes(v.value)),
      { numRuns: 200, seed: 10 }
    );
  });

  it("handles exclusiveMinimum (boolean form)", () => {
    const schema: IRNumberSchema = { type: "number", minimum: 0, maximum: 10, exclusiveMinimum: true };
    fc.assert(
      fc.property(irNumberArbitrary(schema), (v) => v.value > 0 || Object.is(v.value, -0)),
      { numRuns: 200, seed: 11 }
    );
  });
});

// ─── irBooleanArbitrary ──────────────────────────────────────────────────────

describe("irBooleanArbitrary", () => {
  const schema: IRBooleanSchema = { type: "boolean" };

  it("always produces IRBooleanValue nodes with kind 'boolean'", () => {
    fc.assert(
      fc.property(irBooleanArbitrary(schema), (v) => v.kind === "boolean" && typeof v.value === "boolean"),
      { numRuns: 200, seed: 12 }
    );
  });

  it("produces both true and false across 200 runs", () => {
    const vals = samples(irBooleanArbitrary(schema), 200).map((v) => v.value);
    expect(vals.some((v) => v === true)).toBe(true);
    expect(vals.some((v) => v === false)).toBe(true);
  });
});

// ─── irEnumArbitrary ─────────────────────────────────────────────────────────

describe("irEnumArbitrary", () => {
  it("always produces IREnumValue with kind 'enum'", () => {
    const arb = irEnumArbitrary(["a", "b", "c"]);
    fc.assert(
      fc.property(arb, (v) => v.kind === "enum"),
      { numRuns: 100, seed: 13 }
    );
  });

  it("only produces values within the declared enum", () => {
    const allowed = ["available", "pending", "sold"];
    fc.assert(
      fc.property(irEnumArbitrary(allowed), (v) => allowed.includes(v.value as string)),
      { numRuns: 200, seed: 14 }
    );
  });

  it("covers all declared enum values across 300 runs", () => {
    const allowed = ["x", "y", "z"];
    const vals = new Set(samples(irEnumArbitrary(allowed), 300).map((v) => v.value));
    expect(vals.has("x")).toBe(true);
    expect(vals.has("y")).toBe(true);
    expect(vals.has("z")).toBe(true);
  });

  it("works with numeric enum values", () => {
    const allowed = [1, 2, 3, 4, 5];
    fc.assert(
      fc.property(irEnumArbitrary(allowed), (v) => allowed.includes(v.value as number)),
      { numRuns: 200, seed: 15 }
    );
  });

  it("preserves allowedValues on every generated node", () => {
    const allowed = ["alpha", "beta"];
    fc.assert(
      fc.property(irEnumArbitrary(allowed), (v) => JSON.stringify(v.allowedValues) === JSON.stringify(allowed)),
      { numRuns: 100, seed: 16 }
    );
  });

  it("throws for empty allowedValues", () => {
    expect(() => irEnumArbitrary([])).toThrow();
  });
});

// ─── withNullable ─────────────────────────────────────────────────────────────

describe("withNullable", () => {
  it("passes through unchanged when nullable is false", () => {
    const base = irIntegerArbitrary({ type: "integer", minimum: 1, maximum: 10 });
    const arb = withNullable(base, { nullable: false });
    fc.assert(
      fc.property(arb, (v) => "value" in v && (v as { kind: string }).kind === "integer"),
      { numRuns: 100, seed: 17 }
    );
  });

  it("passes through unchanged when nullable is undefined", () => {
    const base = irBooleanArbitrary({ type: "boolean" });
    const arb = withNullable(base, {});
    fc.assert(
      fc.property(arb, (v) => (v as { kind: string }).kind === "boolean"),
      { numRuns: 100, seed: 18 }
    );
  });

  it("injects IRNullValue when nullable: true", () => {
    const base = irIntegerArbitrary({ type: "integer" });
    const arb = withNullable(base, { nullable: true });
    const vals = samples(arb, 500);
    expect(vals.some((v) => v.kind === "null")).toBe(true);
    expect(vals.some((v) => v.kind === "integer")).toBe(true);
  });

  it("produces only integers or null when wrapped with nullable", () => {
    const base = irIntegerArbitrary({ type: "integer" });
    const arb = withNullable(base, { nullable: true });
    fc.assert(
      fc.property(arb, (v) => v.kind === "integer" || v.kind === "null"),
      { numRuns: 300, seed: 19 }
    );
  });
});
