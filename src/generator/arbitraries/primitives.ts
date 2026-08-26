/**
 * WireParity - Numeric, Date & Enum Arbitraries (Step 6.3)
 *
 * Provides fast-check arbitraries for `IRIntegerSchema`, `IRNumberSchema`,
 * `IRBooleanSchema`, and enum-valued schemas, with explicit coverage of
 * boundary corner cases:
 *
 *   - Integers: `min`, `max`, `0`, `-1`, `1`, `multipleOf` edges, `int32`/`int64` limits
 *   - Floats:   `min`, `max`, `0`, `-0`, `NaN`-free finite floats, `float`/`double` ranges
 *   - Booleans: always `true` and `false`
 *   - Date/date-time formats: delegated to strings.ts format arbitraries
 *   - Enums: one of the declared values (string or number), with full coverage across runs
 *
 * All arbitraries produce `IRValue` nodes that can be directly inserted
 * into an `IRValueRecord` and handed to the SDK runners.
 */

import * as fc from "fast-check";
import type {
  IRIntegerSchema,
  IRNumberSchema,
  IRBooleanSchema,
  IRIntegerValue,
  IRNumberValue,
  IRBooleanValue,
  IREnumValue,
  IRNullValue,
} from "../../ir/values.js";

// ─── Int32 / Int64 Bounds ────────────────────────────────────────────────────

const INT32_MIN = -2_147_483_648;
const INT32_MAX =  2_147_483_647;
const INT64_MIN = Number.MIN_SAFE_INTEGER; // JS safe approximation of i64
const INT64_MAX = Number.MAX_SAFE_INTEGER;

// ─── Integer Boundary Pool ───────────────────────────────────────────────────

/**
 * Returns extra boundary corner-case integers relevant to `schema`.
 * Always includes: 0, -1, 1, schema.minimum (if present), schema.maximum (if present).
 */
function integerBoundaries(schema: {
  minimum?: number;
  maximum?: number;
  format?: string;
}): number[] {
  const bounds: number[] = [0, -1, 1];

  if (schema.minimum !== undefined) bounds.push(schema.minimum);
  if (schema.maximum !== undefined) bounds.push(schema.maximum);

  // Format limits
  if (schema.format === "int32") {
    bounds.push(INT32_MIN, INT32_MAX);
  } else if (schema.format === "int64") {
    bounds.push(INT64_MIN, INT64_MAX);
  }

  return bounds;
}

// ─── Effective Integer Range ─────────────────────────────────────────────────

function effectiveIntRange(schema: IRIntegerSchema): { min: number; max: number } {
  let min: number;
  let max: number;

  if (schema.format === "int32") {
    min = INT32_MIN;
    max = INT32_MAX;
  } else if (schema.format === "int64") {
    min = INT64_MIN;
    max = INT64_MAX;
  } else {
    min = INT64_MIN;
    max = INT64_MAX;
  }

  if (schema.minimum !== undefined) {
    const effectiveMin =
      typeof schema.exclusiveMinimum === "boolean" && schema.exclusiveMinimum
        ? schema.minimum + 1
        : typeof schema.exclusiveMinimum === "number"
          ? schema.exclusiveMinimum + 1
          : schema.minimum;
    min = Math.max(min, Math.ceil(effectiveMin));
  }

  if (schema.maximum !== undefined) {
    const effectiveMax =
      typeof schema.exclusiveMaximum === "boolean" && schema.exclusiveMaximum
        ? schema.maximum - 1
        : typeof schema.exclusiveMaximum === "number"
          ? schema.exclusiveMaximum - 1
          : schema.maximum;
    max = Math.min(max, Math.floor(effectiveMax));
  }

  return { min, max };
}

// ─── Main Integer Arbitrary ───────────────────────────────────────────────────

/**
 * Returns an `fc.Arbitrary<IRIntegerValue>` for `IRIntegerSchema`.
 *
 * Resolution order:
 *  1. `enum`   → one of the declared integer values
 *  2. default  → random integer within effective [min, max] range,
 *                weighted with boundary corner cases (0, -1, 1, min, max)
 */
export function irIntegerArbitrary(
  schema: IRIntegerSchema
): fc.Arbitrary<IRIntegerValue> {
  if (schema.enum && schema.enum.length > 0) {
    return fc.constantFrom(...schema.enum).map((v) => ({
      kind: "integer" as const,
      value: v,
    }));
  }

  const { min, max } = effectiveIntRange(schema);

  const boundaries = integerBoundaries(schema)
    .filter((n) => n >= min && n <= max);

  const baseArb = fc.integer({ min, max });

  if (boundaries.length === 0) {
    return baseArb.map((v) => ({ kind: "integer" as const, value: v }));
  }

  const boundaryArbs = boundaries.map((b) =>
    fc.constant(b).map((v) => ({ kind: "integer" as const, value: v }))
  );

  return fc.oneof(
    { arbitrary: baseArb.map((v) => ({ kind: "integer" as const, value: v })), weight: 4 },
    ...boundaryArbs.map((a) => ({ arbitrary: a, weight: 1 }))
  );
}

// ─── Float/Double Boundary Pool ──────────────────────────────────────────────

/**
 * Returns boundary corner-case floats for the schema.
 * Always includes: 0, -0 (negative zero), min (if set), max (if set).
 */
function floatBoundaries(schema: {
  minimum?: number;
  maximum?: number;
}): number[] {
  const bounds: number[] = [0, -0];
  if (schema.minimum !== undefined) bounds.push(schema.minimum);
  if (schema.maximum !== undefined) bounds.push(schema.maximum);
  return bounds;
}

// ─── Effective Float Range ────────────────────────────────────────────────────

function effectiveFloatRange(schema: IRNumberSchema): {
  min: number | undefined;
  max: number | undefined;
} {
  let min: number | undefined;
  let max: number | undefined;

  if (schema.minimum !== undefined) {
    min =
      typeof schema.exclusiveMinimum === "boolean" && schema.exclusiveMinimum
        ? schema.minimum + Number.EPSILON
        : typeof schema.exclusiveMinimum === "number"
          ? schema.exclusiveMinimum + Number.EPSILON
          : schema.minimum;
  }

  if (schema.maximum !== undefined) {
    max =
      typeof schema.exclusiveMaximum === "boolean" && schema.exclusiveMaximum
        ? schema.maximum - Number.EPSILON
        : typeof schema.exclusiveMaximum === "number"
          ? schema.exclusiveMaximum - Number.EPSILON
          : schema.maximum;
  }

  return { min, max };
}

// ─── Main Float/Number Arbitrary ──────────────────────────────────────────────

/**
 * Returns an `fc.Arbitrary<IRNumberValue>` for `IRNumberSchema`.
 *
 * Resolution order:
 *  1. `enum`   → one of the declared number values
 *  2. default  → finite double within [min, max], weighted with boundary
 *                corner cases (0, -0, min, max)
 *
 * Note: `-0` is explicitly included in boundaries. JSON.stringify(-0) === "0",
 * but Object.is(-0, 0) is false — this is a known SDK serialization edge case.
 */
export function irNumberArbitrary(
  schema: IRNumberSchema
): fc.Arbitrary<IRNumberValue> {
  if (schema.enum && schema.enum.length > 0) {
    return fc.constantFrom(...schema.enum).map((v) => ({
      kind: "number" as const,
      value: v,
    }));
  }

  const { min, max } = effectiveFloatRange(schema);

  // fc.double produces finite IEEE-754 doubles; noNaN + noDefaultInfinity
  const baseArb = fc.double({
    min: min ?? -Number.MAX_VALUE,
    max: max ?? Number.MAX_VALUE,
    noNaN: true,
  }).filter(Number.isFinite);

  const boundaries = floatBoundaries(schema)
    .filter((n) => {
      if (min !== undefined && n < min) return false;
      if (max !== undefined && n > max) return false;
      return true;
    });

  if (boundaries.length === 0) {
    return baseArb.map((v) => ({ kind: "number" as const, value: v }));
  }

  const boundaryArbs = boundaries.map((b) =>
    fc.constant(b).map((v) => ({ kind: "number" as const, value: v }))
  );

  return fc.oneof(
    { arbitrary: baseArb.map((v) => ({ kind: "number" as const, value: v })), weight: 4 },
    ...boundaryArbs.map((a) => ({ arbitrary: a, weight: 1 }))
  );
}

// ─── Boolean Arbitrary ───────────────────────────────────────────────────────

/**
 * Returns an `fc.Arbitrary<IRBooleanValue>` for `IRBooleanSchema`.
 * Produces both `true` and `false` with equal probability.
 */
export function irBooleanArbitrary(
  _schema: IRBooleanSchema
): fc.Arbitrary<IRBooleanValue> {
  return fc.boolean().map((v) => ({ kind: "boolean" as const, value: v }));
}

// ─── Enum Arbitrary (Mixed String | Number) ──────────────────────────────────

/**
 * Returns an `fc.Arbitrary<IREnumValue>` for a schema that declares `enum` values.
 * Each value is equally likely across runs.
 *
 * @param allowedValues - The declared enum values (strings or numbers)
 */
export function irEnumArbitrary(
  allowedValues: (string | number)[]
): fc.Arbitrary<IREnumValue> {
  if (allowedValues.length === 0) {
    throw new Error("irEnumArbitrary: allowedValues must not be empty");
  }
  return fc.constantFrom(...allowedValues).map((v) => ({
    kind: "enum" as const,
    value: v,
    allowedValues,
  }));
}

// ─── Nullable Wrapper ────────────────────────────────────────────────────────

/**
 * Wraps any primitive `Arbitrary<T>` to also generate `IRNullValue` when
 * the schema declares `nullable: true`.
 *
 * @param arb     - Base arbitrary to wrap
 * @param schema  - Schema with optional `nullable` flag
 * @param nullWeight - Probability weight for null (default 1 out of 5)
 */
export function withNullable<T>(
  arb: fc.Arbitrary<T>,
  schema: { nullable?: boolean },
  nullWeight = 1
): fc.Arbitrary<T | IRNullValue> {
  if (!schema.nullable) return arb;
  const nullArb = fc.constant<IRNullValue>({ kind: "null" });
  return fc.oneof(
    { arbitrary: arb, weight: 4 },
    { arbitrary: nullArb, weight: nullWeight }
  );
}
