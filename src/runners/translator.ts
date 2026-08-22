import type { IRValue, IRValueRecord } from "../ir/values.js";

/**
 * Converts neutral IRValue AST nodes to standard JavaScript objects / primitives.
 */
export function irValueToJs(val: IRValue): unknown {
  switch (val.kind) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
    case "date":
    case "date-time":
    case "enum":
      return val.value;
    case "null":
      return null;
    case "array":
      return val.items.map(irValueToJs);
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val.fields)) {
        obj[k] = irValueToJs(v);
      }
      return obj;
    }
  }
}

/**
 * Converts a full IRValueRecord to a JS dictionary.
 */
export function irRecordToJs(record: IRValueRecord): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = irValueToJs(v);
  }
  return result;
}
