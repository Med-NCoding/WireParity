/**
 * WireParity - Collections & Nullable Object Arbitraries (Step 6.4)
 *
 * Provides fast-check arbitraries for `IRArraySchema` and `IRObjectSchema`,
 * covering:
 *
 *   - Arrays:   `minItems`, `maxItems`, `uniqueItems` (deduplication by JSON key)
 *   - Objects:  required fields (always present), optional fields (generated in
 *               all subsets: all-present, none, and random subset), plus explicit
 *               `null` vs omitted-key permutations for nullable optional fields.
 *
 * Recursion is handled through a shared `irValueArbitrary` dispatcher that
 * delegates back to the schema-specific arbitraries defined here and in
 * `primitives.ts` / `strings.ts`.
 *
 * All arbitraries produce `IRValue` nodes compatible with `IRValueRecord`.
 */

import * as fc from "fast-check";
import type {
  IRSchema,
  IRArraySchema,
  IRObjectSchema,
  IRArrayValue,
  IRObjectValue,
  IRNullValue,
  IRValue,
} from "../../ir/values.js";
import { irIntegerArbitrary, irNumberArbitrary, irBooleanArbitrary, irEnumArbitrary, withNullable } from "./primitives.js";
import { irStringArbitrary } from "./strings.js";

// ─── Forward Declaration ──────────────────────────────────────────────────────

/**
 * Dispatcher that maps any `IRSchema` to its corresponding `fc.Arbitrary<IRValue>`.
 * Supports the full IRSchema union including recursive array/object schemas.
 *
 * This is the central entry point for the generator subsystem.
 */
export function irValueArbitrary(schema: IRSchema): fc.Arbitrary<IRValue> {
  switch (schema.type) {
    case "string":
      return irStringArbitrary(schema).map((v) => ({ kind: "string" as const, value: v }));

    case "integer":
      if (schema.enum && schema.enum.length > 0) {
        return irEnumArbitrary(schema.enum);
      }
      return withNullable(irIntegerArbitrary(schema), schema);

    case "number":
      if (schema.enum && schema.enum.length > 0) {
        return irEnumArbitrary(schema.enum);
      }
      return withNullable(irNumberArbitrary(schema), schema);

    case "boolean":
      return withNullable(irBooleanArbitrary(schema), schema);

    case "null":
      return fc.constant<IRNullValue>({ kind: "null" });

    case "array":
      return withNullable(irArrayArbitrary(schema), schema) as fc.Arbitrary<IRValue>;

    case "object":
      return withNullable(irObjectArbitrary(schema), schema) as fc.Arbitrary<IRValue>;

    case "any":
      // Produce a small set of representative scalars for untyped schemas
      return fc.oneof(
        fc.constant<IRValue>({ kind: "null" }),
        fc.boolean().map((v) => ({ kind: "boolean" as const, value: v })),
        fc.integer({ min: -100, max: 100 }).map((v) => ({ kind: "integer" as const, value: v })),
        fc.string({ minLength: 0, maxLength: 32 }).map((v) => ({ kind: "string" as const, value: v })),
      );
  }
}

// ─── Array Arbitrary ──────────────────────────────────────────────────────────

/**
 * Effective item count bounds derived from an `IRArraySchema`.
 * Clamps to a sensible max (64) to keep generation tractable.
 */
function effectiveArrayBounds(schema: IRArraySchema): { min: number; max: number } {
  const min = schema.minItems ?? 0;
  const max = schema.maxItems ?? Math.max(min, 8); // default max: 8 items
  return { min: Math.min(min, max), max: Math.min(max, 64) };
}

/**
 * Returns an `fc.Arbitrary<IRArrayValue>` for `IRArraySchema`.
 *
 * Behaviour:
 *  - Generates arrays of `[minItems, maxItems]` length using the item schema.
 *  - When `uniqueItems: true`, deduplicates by JSON-serialized key (preserving
 *    order of first occurrence). Note: order is preserved per the WireParity
 *    contract - `uniqueItems` does NOT imply set semantics for ordering.
 *  - Corner-case arrays (empty [], single element) are included in the mix.
 */
export function irArrayArbitrary(schema: IRArraySchema): fc.Arbitrary<IRArrayValue> {
  const { min, max } = effectiveArrayBounds(schema);
  const itemArb = irValueArbitrary(schema.items);

  const baseArb = fc.array(itemArb, { minLength: min, maxLength: max });

  const wrappedArb = schema.uniqueItems
    ? baseArb.map((items) => deduplicateIRValues(items))
    : baseArb;

  return wrappedArb.map((items) => ({ kind: "array" as const, items }));
}

/**
 * Deduplicates an array of `IRValue`s by their JSON-serialised key,
 * preserving insertion order of the first occurrence.
 */
function deduplicateIRValues(values: IRValue[]): IRValue[] {
  const seen = new Set<string>();
  const result: IRValue[] = [];
  for (const v of values) {
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }
  return result;
}

// ─── Object Arbitrary ────────────────────────────────────────────────────────

/**
 * Returns an `fc.Arbitrary<IRObjectValue>` for `IRObjectSchema`.
 *
 * Field handling:
 *  1. **Required fields**: Always generated using their schema arbitrary.
 *  2. **Optional fields**: Generated across three permutations (mixed via oneof):
 *       - All optional fields present
 *       - No optional fields present (fields omitted entirely)
 *       - Random subset of optional fields present
 *  3. **Nullable optional fields**: When a non-required field schema has
 *     `nullable: true`, the presence/null/omit distinction is exercised:
 *       - Field present with a real value
 *       - Field present with explicit `null`
 *       - Field omitted entirely
 *
 * Additional properties (when `additionalProperties` is an `IRSchema`) are
 * generated with 0-3 extra string-keyed entries.
 */
export function irObjectArbitrary(schema: IRObjectSchema): fc.Arbitrary<IRObjectValue> {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const propNames = Object.keys(props);

  const requiredNames = propNames.filter((k) => required.has(k));
  const optionalNames = propNames.filter((k) => !required.has(k));

  // Build required fields record arbitrary
  const requiredArb: fc.Arbitrary<Record<string, IRValue>> =
    requiredNames.length === 0
      ? fc.constant({})
      : fc
          .tuple(...requiredNames.map((k) => irValueArbitrary(props[k]!)))
          .map((values) => Object.fromEntries(requiredNames.map((k, i) => [k, values[i]!])));

  // Build optional fields record arbitrary covering all subset permutations
  const optionalArb: fc.Arbitrary<Record<string, IRValue>> =
    optionalNames.length === 0
      ? fc.constant({})
      : buildOptionalFieldsArbitrary(optionalNames, props);

  // Build additional properties arbitrary (if schema specifies extra entries)
  const additionalArb: fc.Arbitrary<Record<string, IRValue>> = buildAdditionalPropertiesArbitrary(schema);

  // Merge required + optional + additional
  return fc
    .tuple(requiredArb, optionalArb, additionalArb)
    .map(([req, opt, add]) => ({
      kind: "object" as const,
      fields: { ...req, ...opt, ...add },
    }));
}

/**
 * Builds an arbitrary for the optional fields of an object, covering:
 *  - All optional fields present (full object)
 *  - No optional fields (empty partial)
 *  - A random subset of optional fields
 *  - Nullable optional fields may appear as explicit `null` or be omitted
 */
function buildOptionalFieldsArbitrary(
  names: string[],
  props: Record<string, IRSchema>
): fc.Arbitrary<Record<string, IRValue>> {
  type FieldOption = IRValue | null | undefined;

  const perFieldArbs: fc.Arbitrary<FieldOption>[] = names.map((name) => {
    const fieldSchema = props[name]!;
    const valueArb = irValueArbitrary(fieldSchema);
    const isNullable = "nullable" in fieldSchema && fieldSchema.nullable === true;

    if (isNullable) {
      // Three possibilities: real value, explicit null, or omitted
      return fc.oneof(
        { arbitrary: valueArb as fc.Arbitrary<FieldOption>, weight: 3 },
        { arbitrary: fc.constant<IRNullValue>({ kind: "null" }) as fc.Arbitrary<FieldOption>, weight: 1 },
        { arbitrary: fc.constant<undefined>(undefined) as fc.Arbitrary<FieldOption>, weight: 1 },
      );
    } else {
      // Two possibilities: real value or omitted
      return fc.oneof(
        { arbitrary: valueArb as fc.Arbitrary<FieldOption>, weight: 3 },
        { arbitrary: fc.constant<undefined>(undefined) as fc.Arbitrary<FieldOption>, weight: 1 },
      );
    }
  });

  return fc.tuple(...perFieldArbs).map((fieldOptions) => {
    const record: Record<string, IRValue> = {};
    for (let i = 0; i < names.length; i++) {
      const opt = fieldOptions[i];
      if (opt !== undefined) {
        record[names[i]!] = opt as IRValue;
      }
    }
    return record;
  });
}

/**
 * Builds an arbitrary for `additionalProperties` when specified as a schema.
 * Generates 0-3 extra entries with random ASCII-identifier keys to avoid
 * collisions with declared property names.
 */
function buildAdditionalPropertiesArbitrary(schema: IRObjectSchema): fc.Arbitrary<Record<string, IRValue>> {
  if (
    schema.additionalProperties === undefined ||
    schema.additionalProperties === false ||
    schema.additionalProperties === true
  ) {
    return fc.constant({});
  }

  const valueSchema = schema.additionalProperties as IRSchema;
  const valueArb = irValueArbitrary(valueSchema);

  const keyArb = fc.string({ minLength: 3, maxLength: 10, unit: "grapheme-ascii" }).filter(
    (k) => /^[a-z][a-z0-9_]*$/.test(k) && !(k in (schema.properties ?? {}))
  );

  return fc
    .array(fc.tuple(keyArb, valueArb), { minLength: 0, maxLength: 3 })
    .map((pairs) => {
      const record: Record<string, IRValue> = {};
      for (const [k, v] of pairs) {
        record[k] = v;
      }
      return record;
    });
}
