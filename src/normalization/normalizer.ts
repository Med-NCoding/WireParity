import type { CapturedRequest } from "../capture/types.js";
import {
  DEFAULT_IGNORED_HEADERS,
  type NormalizationOptions,
  type NormalizedRequest,
} from "./types.js";

/**
 * Normalizes a raw CapturedRequest into a canonical NormalizedRequest.
 * Strips away harmless differences in header casing, key ordering, trailing slashes,
 * and transport headers.
 */
export function normalizeRequest(
  raw: CapturedRequest,
  options: NormalizationOptions = {}
): NormalizedRequest {
  const ignoredHeaders = new Set(
    (options.ignoredHeaders ?? DEFAULT_IGNORED_HEADERS).map((h) => h.toLowerCase())
  );
  const stripTrailingSlash = options.stripTrailingSlash ?? true;

  // 1. Method normalization
  const method = raw.method.toUpperCase().trim();

  // 2. Path normalization
  let path = raw.path || "/";
  path = path.replace(/\/{2,}/g, "/"); // collapse duplicate slashes
  if (stripTrailingSlash && path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  // 3. Header normalization
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.headers)) {
    const lowerKey = key.toLowerCase().trim();
    if (ignoredHeaders.has(lowerKey) || value === undefined) {
      continue;
    }
    // Collapse multi-value headers to comma-separated string
    const stringVal = Array.isArray(value) ? value.join(", ") : String(value);
    headers[lowerKey] = stringVal.trim();
  }

  // 4. Query normalization
  const query: Record<string, string[]> = {};
  const sortedQueryKeys = Object.keys(raw.query).sort();

  for (const key of sortedQueryKeys) {
    const val = raw.query[key];
    let arrayVal: string[];
    if (Array.isArray(val)) {
      arrayVal = [...val];
    } else if (typeof val === "string") {
      arrayVal = [val];
    } else {
      arrayVal = [];
    }

    if (options.sortQueryArrays) {
      arrayVal.sort();
    }
    query[key] = arrayVal;
  }

  // 5. Body normalization
  let body: unknown | null = null;
  if (raw.jsonBody !== null && raw.jsonBody !== undefined) {
    body = normalizeJson(raw.jsonBody);
  } else if (raw.body !== null && raw.body.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw.body);
      body = normalizeJson(parsed);
    } catch {
      body = raw.body;
    }
  }

  return {
    method,
    path,
    query,
    headers,
    body,
    rawBody: raw.body,
  };
}

function normalizeJson(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === "number") {
    // Normalizes -0 to 0
    return Object.is(val, -0) ? 0 : val;
  }

  if (typeof val === "string") {
    // ISO-8601 Date normalization if exact matching format
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    if (isoDateRegex.test(val)) {
      const parsedDate = new Date(val);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString();
      }
    }
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => normalizeJson(item));
  }

  if (typeof val === "object") {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).sort();
    for (const key of keys) {
      const propVal = (val as Record<string, unknown>)[key];
      // Keep explicit nulls, drop undefined
      if (propVal !== undefined) {
        sortedObj[key] = normalizeJson(propVal);
      }
    }
    return sortedObj;
  }

  return val;
}
