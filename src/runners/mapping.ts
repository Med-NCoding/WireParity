/**
 * WireParity SDK Invocation Mapping Model (Step 3.2)
 *
 * Translates language-neutral OperationInputs into language-specific SDK method call signatures:
 * - TypeScript: named request object (for typescript-fetch with useSingleRequestParameter) or positional args
 * - Python: keyword arguments (kwargs) with snake_case parameter normalization
 * - Go: struct pointers and PascalCase field mappings
 */

import type { OperationInputs } from "../ir/inputs.js";
import { irValueToJs } from "./translator.js";
import type { SDKLanguage } from "./types.js";

// ---------------------------------------------------------------------------
// String Casing Utilities
// ---------------------------------------------------------------------------

/**
 * Converts a parameter name (e.g. "Accept-Language", "pet_id", "X-Request-ID") to camelCase.
 */
export function toCamelCase(str: string): string {
  if (!str) return "";
  // Split on hyphens, underscores, dots, and whitespace, or camelCase transitions
  const words = str
    .replace(/[-_.\s]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/);

  if (words.length === 0 || !words[0]) return "";

  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

/**
 * Converts a parameter name (e.g. "Accept-Language", "petId", "X-Request-ID") to snake_case.
 */
export function toSnakeCase(str: string): string {
  if (!str) return "";
  return str
    .replace(/[-.\s]+/g, "_")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Converts a parameter name (e.g. "Accept-Language", "pet_id", "limit") to PascalCase.
 */
export function toPascalCase(str: string): string {
  if (!str) return "";
  const words = str
    .replace(/[-_.\s]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/);

  return words
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Language Invocation Models
// ---------------------------------------------------------------------------

export interface TypeScriptNamedInvocation {
  style: "namedObject";
  params: Record<string, unknown>;
}

export interface TypeScriptPositionalInvocation {
  style: "positional";
  args: unknown[];
}

export type TypeScriptInvocation = TypeScriptNamedInvocation | TypeScriptPositionalInvocation;

export interface PythonInvocation {
  kwargs: Record<string, unknown>;
  args?: unknown[];
}

export interface GoInvocation {
  pathParams: Record<string, string>;
  requestStruct: Record<string, unknown>;
}

export type LanguageInvocation = TypeScriptInvocation | PythonInvocation | GoInvocation;

// ---------------------------------------------------------------------------
// Mapping Options
// ---------------------------------------------------------------------------

export interface TypeScriptMappingOptions {
  style?: "namedObject" | "positional";
  bodyParamName?: string;
  casing?: "camelCase" | "preserve";
}

export interface PythonMappingOptions {
  bodyParamName?: string;
  casing?: "snake_case" | "preserve";
}

export interface GoMappingOptions {
  bodyParamName?: string;
  casing?: "PascalCase" | "preserve";
}

// ---------------------------------------------------------------------------
// Mapping Implementations
// ---------------------------------------------------------------------------

/**
 * Maps OperationInputs into TypeScript SDK invocation parameters.
 */
export function mapToTypeScript(
  _operationId: string,
  inputs: OperationInputs,
  options: TypeScriptMappingOptions = {}
): TypeScriptInvocation {
  const style = options.style ?? "namedObject";
  const bodyParamName = options.bodyParamName ?? "body";
  const casing = options.casing ?? "camelCase";

  const transformKey = (k: string): string => (casing === "camelCase" ? toCamelCase(k) : k);

  const params: Record<string, unknown> = {};

  // 1. Path parameters
  for (const [k, v] of Object.entries(inputs.pathParams)) {
    params[transformKey(k)] = irValueToJs(v);
  }

  // 2. Query parameters
  for (const [k, v] of Object.entries(inputs.queryParams)) {
    params[transformKey(k)] = irValueToJs(v);
  }

  // 3. Header parameters
  for (const [k, v] of Object.entries(inputs.headerParams)) {
    params[transformKey(k)] = irValueToJs(v);
  }

  // 4. Cookie parameters
  if (inputs.cookieParams) {
    for (const [k, v] of Object.entries(inputs.cookieParams)) {
      params[transformKey(k)] = irValueToJs(v);
    }
  }

  // 5. Body
  if (inputs.body !== undefined) {
    params[bodyParamName] = irValueToJs(inputs.body);
  }

  if (style === "namedObject") {
    return {
      style: "namedObject",
      params,
    };
  }

  return {
    style: "positional",
    args: Object.values(params),
  };
}

/**
 * Maps OperationInputs into Python SDK keyword arguments (kwargs).
 */
export function mapToPython(
  _operationId: string,
  inputs: OperationInputs,
  options: PythonMappingOptions = {}
): PythonInvocation {
  const bodyParamName = options.bodyParamName ?? "body";
  const casing = options.casing ?? "snake_case";

  const transformKey = (k: string): string => (casing === "snake_case" ? toSnakeCase(k) : k);

  const kwargs: Record<string, unknown> = {};

  // 1. Path parameters
  for (const [k, v] of Object.entries(inputs.pathParams)) {
    kwargs[transformKey(k)] = irValueToJs(v);
  }

  // 2. Query parameters
  for (const [k, v] of Object.entries(inputs.queryParams)) {
    kwargs[transformKey(k)] = irValueToJs(v);
  }

  // 3. Header parameters
  for (const [k, v] of Object.entries(inputs.headerParams)) {
    kwargs[transformKey(k)] = irValueToJs(v);
  }

  // 4. Cookie parameters
  if (inputs.cookieParams) {
    for (const [k, v] of Object.entries(inputs.cookieParams)) {
      kwargs[transformKey(k)] = irValueToJs(v);
    }
  }

  // 5. Body
  if (inputs.body !== undefined) {
    kwargs[transformKey(bodyParamName)] = irValueToJs(inputs.body);
  }

  return {
    kwargs,
  };
}

/**
 * Maps OperationInputs into Go SDK request struct and path parameters.
 */
export function mapToGo(
  _operationId: string,
  inputs: OperationInputs,
  options: GoMappingOptions = {}
): GoInvocation {
  const bodyParamName = options.bodyParamName ?? "Body";
  const casing = options.casing ?? "PascalCase";

  const transformKey = (k: string): string => (casing === "PascalCase" ? toPascalCase(k) : k);

  const pathParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs.pathParams)) {
    const val = irValueToJs(v);
    pathParams[k] = val !== null && val !== undefined ? String(val) : "";
  }

  const requestStruct: Record<string, unknown> = {};

  // Query parameters
  for (const [k, v] of Object.entries(inputs.queryParams)) {
    requestStruct[transformKey(k)] = irValueToJs(v);
  }

  // Header parameters
  for (const [k, v] of Object.entries(inputs.headerParams)) {
    requestStruct[transformKey(k)] = irValueToJs(v);
  }

  // Cookie parameters
  if (inputs.cookieParams) {
    for (const [k, v] of Object.entries(inputs.cookieParams)) {
      requestStruct[transformKey(k)] = irValueToJs(v);
    }
  }

  // Body
  if (inputs.body !== undefined) {
    requestStruct[transformKey(bodyParamName)] = irValueToJs(inputs.body);
  }

  return {
    pathParams,
    requestStruct,
  };
}

// ---------------------------------------------------------------------------
// Unified SDK Invocation Mapper Interface & Classes
// ---------------------------------------------------------------------------

export interface SDKInvocationMapper<TInvocation extends LanguageInvocation = LanguageInvocation> {
  readonly language: SDKLanguage;
  mapInvocation(operationId: string, inputs: OperationInputs): TInvocation;
}

export class TypeScriptInvocationMapper implements SDKInvocationMapper<TypeScriptInvocation> {
  readonly language: SDKLanguage = "typescript";
  constructor(private readonly options: TypeScriptMappingOptions = {}) {}

  mapInvocation(operationId: string, inputs: OperationInputs): TypeScriptInvocation {
    return mapToTypeScript(operationId, inputs, this.options);
  }
}

export class PythonInvocationMapper implements SDKInvocationMapper<PythonInvocation> {
  readonly language: SDKLanguage = "python";
  constructor(private readonly options: PythonMappingOptions = {}) {}

  mapInvocation(operationId: string, inputs: OperationInputs): PythonInvocation {
    return mapToPython(operationId, inputs, this.options);
  }
}

export class GoInvocationMapper implements SDKInvocationMapper<GoInvocation> {
  readonly language: SDKLanguage = "go";
  constructor(private readonly options: GoMappingOptions = {}) {}

  mapInvocation(operationId: string, inputs: OperationInputs): GoInvocation {
    return mapToGo(operationId, inputs, this.options);
  }
}

/**
 * Returns the default SDKInvocationMapper for the given language.
 */
export function getInvocationMapper(language: SDKLanguage): SDKInvocationMapper {
  switch (language) {
    case "typescript":
      return new TypeScriptInvocationMapper();
    case "python":
      return new PythonInvocationMapper();
    case "go":
      return new GoInvocationMapper();
    case "mock":
    default:
      return new TypeScriptInvocationMapper();
  }
}
