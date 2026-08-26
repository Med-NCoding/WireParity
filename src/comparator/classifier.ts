import type { DivergenceCategory } from "./types.js";

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
    if (pathStr.includes("authorization")) {
      return {
        category: "AUTH_HEADER_SCHEME",
        message: `Authorization header difference: '${valA}' vs '${valB}'`,
      };
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
    if (valA === undefined || valB === undefined) {
      return {
        category: "QUERY_KEY_MISSING",
        message: `Query parameter '${pathStr}' was sent by one SDK but omitted by the other`,
      };
    }

    if (Array.isArray(valA) && Array.isArray(valB)) {
      // Check if one is comma joined vs exploded
      if (valA.length !== valB.length) {
        return {
          category: "QUERY_ENCODING_DIVERGENCE",
          message: `Query array formatting divergence for '${pathStr}': [${valA.join(",")}] vs [${valB.join(",")}]`,
        };
      }
    }

    return {
      category: "QUERY_VALUE_MISMATCH",
      message: `Query parameter '${pathStr}' value divergence: '${valA}' vs '${valB}'`,
    };
  }

  // Location === "body"
  if (pathStr === "body" && (valA === null || valA === undefined || valB === null || valB === undefined)) {
    return {
      category: "BODY_MISSING",
      message: `Request body is present in one SDK but missing/null in the other`,
    };
  }

  if (valA === undefined && valB === null) {
    return {
      category: "OPTIONAL_VS_NULL",
      message: `Key '${pathStr}' was omitted (undefined) in one SDK, but explicitly sent as 'null' in the other`,
    };
  }
  if (valA === null && valB === undefined) {
    return {
      category: "OPTIONAL_VS_NULL",
      message: `Key '${pathStr}' was explicitly sent as 'null' in one SDK, but omitted in the other`,
    };
  }

  if (valA === undefined || valB === undefined) {
    return {
      category: "BODY_PROPERTY_MISMATCH",
      message: `Property '${pathStr}' is missing in one SDK body`,
    };
  }

  // Date / Timestamp mismatch (e.g. integer unix timestamp vs ISO string)
  if (
    (typeof valA === "string" && typeof valB === "number") ||
    (typeof valA === "number" && typeof valB === "string")
  ) {
    const isIsoOrEpoch =
      (typeof valA === "string" && /^\d{4}-\d{2}-\d{2}/.test(valA)) ||
      (typeof valB === "string" && /^\d{4}-\d{2}-\d{2}/.test(valB));

    if (isIsoOrEpoch) {
      return {
        category: "DATETIME_FORMAT_MISMATCH",
        message: `Date/Time representation mismatch at '${pathStr}': '${valA}' vs '${valB}'`,
      };
    }
  }

  // Enum serialization differences (e.g. "PLACED" vs "placed", uppercase vs lowercase)
  if (
    typeof valA === "string" &&
    typeof valB === "string" &&
    valA.toLowerCase() === valB.toLowerCase() &&
    valA !== valB
  ) {
    return {
      category: "ENUM_SERIALIZATION_ERROR",
      message: `Enum casing divergence at '${pathStr}': '${valA}' vs '${valB}'`,
    };
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
