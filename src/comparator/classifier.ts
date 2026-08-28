import type { DivergenceCategory } from "./types.js";
import { classifyOptionalVsNull, classifyCaseLeakOnValue } from "./classifiers/null_and_case.js";
import { classifyAuthHeaderDivergence, classifyQueryDivergence } from "./classifiers/query_and_auth.js";
import { classifyDateTimeDivergence, classifyEnumDivergence } from "./classifiers/datetime_and_enum.js";

/**
 * Classifies the semantic root cause of a discrepancy between two values.
 */
export function classifyDivergence(
  location: "method" | "path" | "query" | "headers" | "body",
  pathStr: string,
  valA: unknown,
  valB: unknown
): { category: DivergenceCategory; message: string } {
  if (location === "method") {
    return {
      category: "METHOD_MISMATCH",
      message: `HTTP Method mismatch: '${valA}' vs '${valB}'`,
    };
  }

  if (location === "path") {
    return {
      category: "PATH_MISMATCH",
      message: `Path mismatch: '${valA}' vs '${valB}'`,
    };
  }

  if (location === "headers") {
    const authDiff = classifyAuthHeaderDivergence(pathStr, valA, valB);
    if (authDiff) {
      return { category: authDiff.category, message: authDiff.message };
    }
    if (valA === undefined || valB === undefined) {
      return {
        category: "HEADER_MISSING",
        message: `Header '${pathStr}' is missing in one of the SDK requests`,
      };
    }
    return {
      category: "HEADER_VALUE_MISMATCH",
      message: `Header '${pathStr}' value mismatch: '${valA}' vs '${valB}'`,
    };
  }

  if (location === "query") {
    const queryDiff = classifyQueryDivergence(pathStr, valA, valB);
    return { category: queryDiff.category, message: queryDiff.message };
  }

  // Location === "body"
  if (pathStr === "body" && (valA === null || valA === undefined || valB === null || valB === undefined)) {
    return {
      category: "BODY_MISSING",
      message: `Request body is present in one SDK but missing/null in the other`,
    };
  }

  const optNullDiff = classifyOptionalVsNull(pathStr, valA, valB);
  if (optNullDiff) {
    return { category: optNullDiff.category, message: optNullDiff.message };
  }

  if (valA === undefined || valB === undefined) {
    return {
      category: "BODY_PROPERTY_MISMATCH",
      message: `Property '${pathStr}' is missing in one SDK body`,
    };
  }

  // Date / Timestamp mismatch (e.g. integer unix timestamp vs ISO string)
  const dtDiff = classifyDateTimeDivergence(pathStr, valA, valB);
  if (dtDiff) {
    return { category: dtDiff.category, message: dtDiff.message };
  }

  // Enum serialization differences (e.g. ordinal integer, casing divergence)
  const enumDiff = classifyEnumDivergence(pathStr, valA, valB);
  if (enumDiff) {
    return { category: enumDiff.category, message: enumDiff.message };
  }

  // Casing convention leak on values
  const caseDiff = classifyCaseLeakOnValue(pathStr, valA, valB);
  if (caseDiff) {
    return { category: caseDiff.category, message: caseDiff.message };
  }

  // Type mismatch
  if (typeof valA !== typeof valB) {
    return {
      category: "BODY_TYPE_MISMATCH",
      message: `Type mismatch at '${pathStr}': ${typeof valA} vs ${typeof valB}`,
    };
  }

  return {
    category: "BODY_PROPERTY_MISMATCH",
    message: `Body value divergence at '${pathStr}': ${JSON.stringify(valA)} vs ${JSON.stringify(valB)}`,
  };
}

