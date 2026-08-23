/**
 * WireParity Intermediate Representation (IR) - Operation Inputs
 *
 * Provides a structured model separating path, query, header, and cookie parameters
 * alongside request bodies into typed namespaces for language runners.
 */

import type { IRValue, IRValueRecord } from "./values.js";

export interface OperationInputs {
  pathParams: IRValueRecord;
  queryParams: IRValueRecord;
  headerParams: IRValueRecord;
  cookieParams?: IRValueRecord;
  body?: IRValue;
}

/**
 * Creates an OperationInputs structure with sensible defaults for empty namespaces.
 */
export function createOperationInputs(
  partial: Partial<OperationInputs> = {}
): OperationInputs {
  return {
    pathParams: partial.pathParams ? { ...partial.pathParams } : {},
    queryParams: partial.queryParams ? { ...partial.queryParams } : {},
    headerParams: partial.headerParams ? { ...partial.headerParams } : {},
    cookieParams: partial.cookieParams ? { ...partial.cookieParams } : {},
    body: partial.body,
  };
}

/**
 * Checks if a value conforms to the OperationInputs structure.
 */
export function isOperationInputs(value: unknown): value is OperationInputs {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.pathParams === "object" &&
    candidate.pathParams !== null &&
    typeof candidate.queryParams === "object" &&
    candidate.queryParams !== null &&
    typeof candidate.headerParams === "object" &&
    candidate.headerParams !== null
  );
}
