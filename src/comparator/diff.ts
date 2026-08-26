import type { NormalizedRequest } from "../normalization/types.js";
import { classifyDivergence } from "./classifier.js";
import type { ComparisonResult, SemanticDiff } from "./types.js";

/**
 * Compares two or more normalized requests from different SDK runs
 * and returns detailed structural semantic diffs and divergence classifications.
 */
export function compareRequests(
  requests: Record<string, NormalizedRequest>
): ComparisonResult {
  const sdkNames = Object.keys(requests);
  const diffs: SemanticDiff[] = [];

  if (sdkNames.length < 2) {
    return {
      hasDivergence: false,
      diffs: [],
      sdkRequests: requests,
    };
  }

  const baselineSdk = sdkNames[0];
  const reqA = requests[baselineSdk];

  for (let i = 1; i < sdkNames.length; i++) {
    const compareSdk = sdkNames[i];
    const reqB = requests[compareSdk];

    diffRequestsPair(baselineSdk, reqA, compareSdk, reqB, diffs);
  }

  return {
    hasDivergence: diffs.length > 0,
    diffs,
    sdkRequests: requests,
  };
}

function diffRequestsPair(
  sdkA: string,
  reqA: NormalizedRequest,
  sdkB: string,
  reqB: NormalizedRequest,
  diffs: SemanticDiff[]
) {
  // 1. Method
  if (reqA.method !== reqB.method) {
    const { category, message } = classifyDivergence("method", "method", reqA.method, reqB.method);
    diffs.push({
      category,
      severity: "critical",
      location: "method",
      path: "method",
      message,
      expected: reqA.method,
      actual: reqB.method,
      sdkA,
      sdkB,
    });
  }

  // 2. Path
  if (reqA.path !== reqB.path) {
    const { category, message } = classifyDivergence("path", "path", reqA.path, reqB.path);
    diffs.push({
      category,
      severity: "critical",
      location: "path",
      path: "path",
      message,
      expected: reqA.path,
      actual: reqB.path,
      sdkA,
      sdkB,
    });
  }

  // 3. Headers
  const allHeaderKeys = Array.from(
    new Set([...Object.keys(reqA.headers), ...Object.keys(reqB.headers)])
  );
  for (const headerKey of allHeaderKeys) {
    const valA = reqA.headers[headerKey];
    const valB = reqB.headers[headerKey];
    if (valA !== valB) {
      const { category, message } = classifyDivergence(
        "headers",
        headerKey,
        valA,
        valB
      );
      diffs.push({
        category,
        severity: headerKey.includes("auth") ? "critical" : "warning",
        location: "headers",
        path: `headers.${headerKey}`,
        message,
        expected: valA,
        actual: valB,
        sdkA,
        sdkB,
      });
    }
  }

  // 4. Query parameters
  const allQueryKeys = Array.from(
    new Set([...Object.keys(reqA.query), ...Object.keys(reqB.query)])
  );
  for (const queryKey of allQueryKeys) {
    const valA = reqA.query[queryKey];
    const valB = reqB.query[queryKey];

    if (!isEqualDeep(valA, valB)) {
      const { category, message } = classifyDivergence(
        "query",
        queryKey,
        valA,
        valB
      );
      diffs.push({
        category,
        severity: "critical",
        location: "query",
        path: `query.${queryKey}`,
        message,
        expected: valA,
        actual: valB,
        sdkA,
        sdkB,
      });
    }
  }

  // 5. Body
  diffBodies(reqA.body, reqB.body, "body", sdkA, sdkB, diffs);
}

function diffBodies(
  bodyA: unknown,
  bodyB: unknown,
  path: string,
  sdkA: string,
  sdkB: string,
  diffs: SemanticDiff[]
) {
  if (isEqualDeep(bodyA, bodyB)) {
    return;
  }

  if (
    typeof bodyA === "object" &&
    bodyA !== null &&
    typeof bodyB === "object" &&
    bodyB !== null &&
    !Array.isArray(bodyA) &&
    !Array.isArray(bodyB)
  ) {
    const objA = bodyA as Record<string, unknown>;
    const objB = bodyB as Record<string, unknown>;
    const allKeys = Array.from(new Set([...Object.keys(objA), ...Object.keys(objB)]));

    for (const key of allKeys) {
      const valA = objA[key];
      const valB = objB[key];
      diffBodies(valA, valB, `${path}.${key}`, sdkA, sdkB, diffs);
    }
    return;
  }

  if (Array.isArray(bodyA) && Array.isArray(bodyB)) {
    const maxLen = Math.max(bodyA.length, bodyB.length);
    for (let i = 0; i < maxLen; i++) {
      const valA = bodyA[i];
      const valB = bodyB[i];
      diffBodies(valA, valB, `${path}[${i}]`, sdkA, sdkB, diffs);
    }
    return;
  }

  const { category, message } = classifyDivergence("body", path, bodyA, bodyB);
  diffs.push({
    category,
    severity: "critical",
    location: "body",
    path,
    message,
    expected: bodyA,
    actual: bodyB,
    sdkA,
    sdkB,
  });
}

function isEqualDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqualDeep(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object" && typeof b === "object") {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
      if (!isEqualDeep(objA[key], objB[key])) return false;
    }
    return true;
  }

  return false;
}
