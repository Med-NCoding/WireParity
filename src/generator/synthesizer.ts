import type { IRObjectValue, IRSchema, IRValue } from "../ir/values.js";
import { SeededPRNG } from "./prng.js";

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
