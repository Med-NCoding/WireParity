/**
 * WireParity Intermediate Representation (IR) - Values & Schemas
 *
 * Provides a language-neutral model for primitive and composite values,
 * formats, and schema constraints.
 */

export type IRPrimitiveType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "null";

export type IRFormat =
  | "date"
  | "date-time"
  | "password"
  | "byte"
  | "binary"
  | "email"
  | "uuid"
  | "uri"
  | "hostname"
  | "ipv4"
  | "ipv6"
  | "time"
  | "duration"
  | "int32"
  | "int64"
  | "float"
  | "double";

export interface IRStringSchema {
  type: "string";
  format?: IRFormat | string;
  enum?: string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  nullable?: boolean;
  default?: string;
  description?: string;
}

export interface IRIntegerSchema {
  type: "integer";
  format?: "int32" | "int64" | string;
  enum?: number[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  multipleOf?: number;
  nullable?: boolean;
  default?: number;
  description?: string;
}

export interface IRNumberSchema {
  type: "number";
  format?: "float" | "double" | string;
  enum?: number[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  multipleOf?: number;
  nullable?: boolean;
  default?: number;
  description?: string;
}

export interface IRBooleanSchema {
  type: "boolean";
  nullable?: boolean;
  default?: boolean;
  description?: string;
}

export interface IRNullSchema {
  type: "null";
  description?: string;
}

export interface IRArraySchema {
  type: "array";
  items: IRSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  nullable?: boolean;
  description?: string;
}

export interface IRObjectSchema {
  type: "object";
  properties: Record<string, IRSchema>;
  required?: string[];
  additionalProperties?: boolean | IRSchema;
  minProperties?: number;
  maxProperties?: number;
  nullable?: boolean;
  description?: string;
}

export interface IRAnySchema {
  type: "any";
  nullable?: boolean;
  description?: string;
}

export type IRSchema =
  | IRStringSchema
  | IRIntegerSchema
  | IRNumberSchema
  | IRBooleanSchema
  | IRNullSchema
  | IRArraySchema
  | IRObjectSchema
  | IRAnySchema;

/**
 * Checks if a given IRSchema permits null values (either type === "null" or nullable === true).
 */
export function isNullableSchema(schema: IRSchema): boolean {
  if (schema.type === "null") return true;
  return schema.nullable === true;
}

// --- IR Value Runtime AST ---

export interface IRStringValue {
  kind: "string";
  value: string;
}

export interface IRIntegerValue {
  kind: "integer";
  value: number;
}

export interface IRNumberValue {
  kind: "number";
  value: number;
}

export interface IRBooleanValue {
  kind: "boolean";
  value: boolean;
}

export interface IRNullValue {
  kind: "null";
}

export interface IRDateValue {
  kind: "date";
  value: string; // YYYY-MM-DD
}

export interface IRDateTimeValue {
  kind: "date-time";
  value: string; // ISO-8601 string
}

export interface IREnumValue {
  kind: "enum";
  value: string | number;
  allowedValues: (string | number)[];
}

export interface IRArrayValue {
  kind: "array";
  items: IRValue[];
}

export interface IRObjectValue {
  kind: "object";
  fields: Record<string, IRValue>;
}

export type IRValue =
  | IRStringValue
  | IRIntegerValue
  | IRNumberValue
  | IRBooleanValue
  | IRNullValue
  | IRDateValue
  | IRDateTimeValue
  | IREnumValue
  | IRArrayValue
  | IRObjectValue;

export type IRValueRecord = Record<string, IRValue>;
