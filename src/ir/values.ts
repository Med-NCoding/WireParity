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
  | "uuid"
  | "byte"
  | "binary"
  | "email"
  | "uri"
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
}

export interface IRIntegerSchema {
  type: "integer";
  format?: "int32" | "int64" | string;
  enum?: number[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  multipleOf?: number;
  nullable?: boolean;
}

export interface IRNumberSchema {
  type: "number";
  format?: "float" | "double" | string;
  enum?: number[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  multipleOf?: number;
  nullable?: boolean;
}

export interface IRBooleanSchema {
  type: "boolean";
  nullable?: boolean;
}

export interface IRNullSchema {
  type: "null";
}

export interface IRArraySchema {
  type: "array";
  items: IRSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  nullable?: boolean;
}

export interface IRObjectSchema {
  type: "object";
  properties: Record<string, IRSchema>;
  required?: string[];
  additionalProperties?: boolean | IRSchema;
  nullable?: boolean;
}

export interface IRAnySchema {
  type: "any";
  nullable?: boolean;
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
