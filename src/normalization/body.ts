/**
 * WireParity - Canonical JSON Body Normalizer (Step 4.3)
 *
 * Responsibilities:
 * 1. Recursively sorts JSON object keys alphabetically for deterministic canonical ordering.
 * 2. Converts -0 to 0 (IEEE 754 negative zero normalization).
 * 3. Normalizes ISO-8601 timestamps to canonical UTC string format.
 * 4. Preserves explicit null values vs omitted/missing keys according to contract rules:
 *    - Explicit null (`{ "key": null }`) is strictly preserved as null.
 *    - Omitted/missing keys (`{}`) are not synthesized.
 *    - `undefined` properties are removed (matching JSON serialization behavior).
 * 5. Handles schema-guided normalization when an IRSchema or IROperation is provided.
 */

import type { IRSchema, IRObjectSchema, IRArraySchema } from "../ir/values.js";
import type { IROperation } from "../ir/operations.js";
import type { CapturedRequest } from "../capture/types.js";

/**
 * Normalizes a JSON value into a canonical structural representation.
 *
 * @param val    - The arbitrary JSON value (object, array, primitive).
 * @param schema - Optional IRSchema describing the expected structure and nullability.
 * @returns      Canonical normalized value.
 */
export function normalizeJsonBody(val: unknown, schema?: IRSchema): unknown {
  if (val === null) {
    return null;
  }

  if (val === undefined) {
    return undefined;
  }

  // 1. Normalize numbers (-0 to 0)
  if (typeof val === "number") {
    return Object.is(val, -0) ? 0 : val;
  }

  // 2. Normalize strings (ISO-8601 date-times)
  if (typeof val === "string") {
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    if (isoDateRegex.test(val)) {
      const parsedDate = new Date(val);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString();
      }
    }
    return val;
  }

  // 3. Normalize arrays recursively
  if (Array.isArray(val)) {
    const itemSchema = schema && schema.type === "array" ? (schema as IRArraySchema).items : undefined;
    return val.map((item) => normalizeJsonBody(item, itemSchema));
  }

  // 4. Normalize objects recursively with sorted keys
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();

    const objSchema = schema && schema.type === "object" ? (schema as IRObjectSchema) : undefined;

    for (const key of keys) {
      const propVal = obj[key];
      // Undefined properties are omitted in valid JSON
      if (propVal === undefined) {
        continue;
      }

      // Determine property schema if available
      let propSchema: IRSchema | undefined;
      if (objSchema?.properties && key in objSchema.properties) {
        propSchema = objSchema.properties[key];
      } else if (objSchema?.additionalProperties && typeof objSchema.additionalProperties === "object") {
        propSchema = objSchema.additionalProperties;
      }

      // Explicit null is preserved as null; missing keys are not synthesized
      sortedObj[key] = normalizeJsonBody(propVal, propSchema);
    }

    return sortedObj;
  }

  return val;
}

/**
 * Extracts and normalizes the body of a CapturedRequest against an optional IROperation.
 *
 * @param raw       - The raw captured HTTP request.
 * @param operation - Optional IR operation defining the API contract and request body schema.
 * @returns         An object containing the normalized body and raw string body.
 */
export function normalizeBody(
  raw: CapturedRequest,
  operation?: IROperation
): { body: unknown | null; rawBody: string | null } {
  let bodySchema: IRSchema | undefined;

  if (operation?.requestBody?.content) {
    const jsonContent =
      operation.requestBody.content["application/json"] ||
      operation.requestBody.content["application/json; charset=utf-8"] ||
      Object.values(operation.requestBody.content)[0];
    bodySchema = jsonContent?.schema;
  }

  let body: unknown | null = null;

  if (raw.jsonBody !== null && raw.jsonBody !== undefined) {
    body = normalizeJsonBody(raw.jsonBody, bodySchema);
  } else if (raw.body !== null && raw.body.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw.body);
      body = normalizeJsonBody(parsed, bodySchema);
    } catch {
      body = raw.body;
    }
  }

  return {
    body,
    rawBody: raw.body,
  };
}
