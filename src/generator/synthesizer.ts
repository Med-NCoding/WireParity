import * as fc from "fast-check";
import type { IROperation, IRParameter, IRRequestBody } from "../ir/operations.js";
import type { OperationInputs } from "../ir/inputs.js";
import type { IRObjectValue, IRSchema, IRValue } from "../ir/values.js";
import { irValueArbitrary } from "./arbitraries/complex.js";
import { hashSeed } from "./seed.js";
import { SeededPRNG } from "./prng.js";

// ─── Fast-Check Operation Inputs Arbitrary ────────────────────────────────────

/**
 * Builds an arbitrary for a list of IRParameters (e.g. path, query, header, or cookie).
 * Required parameters are always generated.
 * Optional parameters are generated with weighted presence or omitted.
 */
function buildParamsArbitrary(
  params: IRParameter[]
): fc.Arbitrary<Record<string, IRValue>> {
  if (params.length === 0) {
    return fc.constant({});
  }

  type ParamOption = IRValue | undefined;

  const perParamArbs: fc.Arbitrary<{ name: string; value: ParamOption }>[] = params.map((p) => {
    const valArb = irValueArbitrary(p.schema);
    if (p.required) {
      return valArb.map((v) => ({ name: p.name, value: v }));
    } else {
      return fc.oneof(
        { arbitrary: valArb.map((v) => ({ name: p.name, value: v })), weight: 3 },
        { arbitrary: fc.constant({ name: p.name, value: undefined }), weight: 1 }
      );
    }
  });

  return fc.tuple(...perParamArbs).map((entries) => {
    const record: Record<string, IRValue> = {};
    for (const entry of entries) {
      if (entry.value !== undefined) {
        record[entry.name] = entry.value;
      }
    }
    return record;
  });
}

/**
 * Builds an arbitrary for request body if defined on the operation.
 * If required: always produces an IRValue according to media type schema.
 * If optional: produces either an IRValue or undefined.
 */
function buildBodyArbitrary(
  requestBody?: IRRequestBody
): fc.Arbitrary<IRValue | undefined> {
  if (!requestBody || !requestBody.content) {
    return fc.constant(undefined);
  }

  const jsonMedia =
    requestBody.content["application/json"] ??
    Object.values(requestBody.content)[0];

  if (!jsonMedia || !jsonMedia.schema) {
    return fc.constant(undefined);
  }

  const bodyValArb = irValueArbitrary(jsonMedia.schema);

  if (requestBody.required) {
    return bodyValArb;
  } else {
    return fc.oneof(
      { arbitrary: bodyValArb, weight: 3 },
      { arbitrary: fc.constant(undefined), weight: 1 }
    );
  }
}

/**
 * Returns a fast-check `Arbitrary<OperationInputs>` synthesizing complete,
 * contract-valid inputs (pathParams, queryParams, headerParams, cookieParams, body)
 * for any given `IROperation`.
 */
export function operationInputsArbitrary(
  operation: IROperation
): fc.Arbitrary<OperationInputs> {
  const pathParams = operation.parameters.filter((p) => p.in === "path");
  const queryParams = operation.parameters.filter((p) => p.in === "query");
  const headerParams = operation.parameters.filter((p) => p.in === "header");
  const cookieParams = operation.parameters.filter((p) => p.in === "cookie");

  const pathArb = buildParamsArbitrary(pathParams);
  const queryArb = buildParamsArbitrary(queryParams);
  const headerArb = buildParamsArbitrary(headerParams);
  const cookieArb = buildParamsArbitrary(cookieParams);
  const bodyArb = buildBodyArbitrary(operation.requestBody);

  return fc
    .tuple(pathArb, queryArb, headerArb, cookieArb, bodyArb)
    .map(([path, query, header, cookie, body]) => {
      const inputs: OperationInputs = {
        pathParams: path,
        queryParams: query,
        headerParams: header,
      };
      if (Object.keys(cookie).length > 0) {
        inputs.cookieParams = cookie;
      }
      if (body !== undefined) {
        inputs.body = body;
      }
      return inputs;
    });
}

/**
 * Synthesizes a single concrete `OperationInputs` for an `IROperation`, optionally
 * seeded for deterministic reproducibility.
 */
export function synthesizeOperationInputs(
  operation: IROperation,
  seed?: number | string
): OperationInputs {
  const arb = operationInputsArbitrary(operation);
  const params: fc.Parameters<OperationInputs> = { numRuns: 1 };
  if (seed !== undefined) {
    params.seed = hashSeed(seed);
  }
  const sampled = fc.sample(arb, params);
  return sampled[0]!;
}


// ─── Legacy SchemaValueGenerator ──────────────────────────────────────────────

const UNICODE_CORNER_CASES = [
  "Hello World",
  "Special &?=#/ %20 spaces",
  "Unicode: 🚀 🔥 ✨",
  "Accents: é à ç ü ø ñ",
  "RTL: العربية עִברִית",
  "Newlines: \n\r\t",
  "", // empty string
];

/**
 * Generates schema-aware IR values, including boundary edge cases and randomized property combinations.
 */
export class SchemaValueGenerator {
  constructor(private readonly prng: SeededPRNG) {}

  generate(schema: IRSchema, depth = 0): IRValue {
    if (depth > 6) {
      return { kind: "string", value: "max_depth" };
    }

    if ("nullable" in schema && schema.nullable && this.prng.next() < 0.5) {
      return { kind: "null" };
    }

    switch (schema.type) {
      case "string":
        return this.generateString(schema);
      case "integer":
        return this.generateInteger(schema);
      case "number":
        return this.generateNumber(schema);
      case "boolean":
        return { kind: "boolean", value: this.prng.nextBoolean() };
      case "null":
        return { kind: "null" };
      case "array":
        return this.generateArray(schema, depth + 1);
      case "object":
        return this.generateObject(schema, depth + 1);
      case "any":
      default:
        return { kind: "string", value: "any_val" };
    }
  }

  private generateString(schema: Extract<IRSchema, { type: "string" }>): IRValue {
    if (schema.enum && schema.enum.length > 0) {
      const picked = this.prng.pick(schema.enum);
      return { kind: "enum", value: picked, allowedValues: schema.enum };
    }

    if (schema.format === "date") {
      const year = this.prng.nextInt(2020, 2030);
      const month = String(this.prng.nextInt(1, 12)).padStart(2, "0");
      const day = String(this.prng.nextInt(1, 28)).padStart(2, "0");
      return { kind: "date", value: `${year}-${month}-${day}` };
    }

    if (schema.format === "date-time") {
      const year = this.prng.nextInt(2020, 2030);
      const month = String(this.prng.nextInt(1, 12)).padStart(2, "0");
      const day = String(this.prng.nextInt(1, 28)).padStart(2, "0");
      const hour = String(this.prng.nextInt(0, 23)).padStart(2, "0");
      const min = String(this.prng.nextInt(0, 59)).padStart(2, "0");
      const sec = String(this.prng.nextInt(0, 59)).padStart(2, "0");
      return { kind: "date-time", value: `${year}-${month}-${day}T${hour}:${min}:${sec}Z` };
    }

    if (schema.format === "uuid") {
      return {
        kind: "string",
        value: "123e4567-e89b-12d3-a456-426614174000",
      };
    }

    // Pick from edge-cases or random characters
    const candidate = this.prng.pick(UNICODE_CORNER_CASES);
    const min = schema.minLength ?? 0;
    const max = schema.maxLength ?? 50;

    let res = candidate;
    if (res.length < min) {
      res = res.padEnd(min, "a");
    }
    if (res.length > max) {
      res = res.slice(0, max);
    }

    return { kind: "string", value: res };
  }

  private generateInteger(schema: Extract<IRSchema, { type: "integer" }>): IRValue {
    if (schema.enum && schema.enum.length > 0) {
      return { kind: "enum", value: this.prng.pick(schema.enum), allowedValues: schema.enum };
    }

    const min = schema.minimum ?? (schema.exclusiveMinimum ? 1 : 0);
    const max = schema.maximum ?? (schema.exclusiveMaximum ? 99 : 100);

    // Boundary value injection (min, max, or random in-between)
    const roll = this.prng.next();
    if (roll < 0.2) return { kind: "integer", value: min };
    if (roll < 0.4) return { kind: "integer", value: max };

    return { kind: "integer", value: this.prng.nextInt(min, max) };
  }

  private generateNumber(schema: Extract<IRSchema, { type: "number" }>): IRValue {
    const min = schema.minimum ?? 0.0;
    const max = schema.maximum ?? 100.0;
    const val = min + this.prng.next() * (max - min);
    return { kind: "number", value: parseFloat(val.toFixed(2)) };
  }

  private generateArray(schema: Extract<IRSchema, { type: "array" }>, depth: number): IRValue {
    const min = schema.minItems ?? 0;
    const max = schema.maxItems ?? 4;
    const count = this.prng.nextInt(min, max);
    const items: IRValue[] = [];

    for (let i = 0; i < count; i++) {
      items.push(this.generate(schema.items, depth));
    }

    return { kind: "array", items };
  }

  private generateObject(schema: Extract<IRSchema, { type: "object" }>, depth: number): IRObjectValue {
    const fields: Record<string, IRValue> = {};
    const required = new Set(schema.required ?? []);

    for (const [propKey, propSchema] of Object.entries(schema.properties)) {
      const isReq = required.has(propKey);
      // Optional property inclusion probability = 70%
      if (isReq || this.prng.next() < 0.7) {
        fields[propKey] = this.generate(propSchema, depth);
      }
    }

    return { kind: "object", fields };
  }
}

