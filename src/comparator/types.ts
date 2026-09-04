import type { NormalizedRequest } from "../normalization/types.js";

export type DivergenceCategory =
  | "METHOD_MISMATCH"
  | "PATH_MISMATCH"
  | "QUERY_KEY_MISSING"
  | "QUERY_VALUE_MISMATCH"
  | "QUERY_ENCODING_DIVERGENCE"
  | "HEADER_MISSING"
  | "HEADER_VALUE_MISMATCH"
  | "AUTH_HEADER_SCHEME"
  | "BODY_MISSING"
  | "OPTIONAL_VS_NULL"
  | "DATETIME_FORMAT_MISMATCH"
  | "CASE_CONVENTION_LEAK"
  | "ENUM_SERIALIZATION_ERROR"
  | "BODY_TYPE_MISMATCH"
  | "BODY_PROPERTY_MISMATCH"
  | "RUNNER_EXECUTION_ERROR"
  | "UNKNOWN_SEMANTIC_DIVERGENCE";

export type DiffSeverity = "critical" | "warning" | "info";

export interface SemanticDiff {
  category: DivergenceCategory;
  severity: DiffSeverity;
  location: "method" | "path" | "query" | "headers" | "body";
  path: string; // e.g. "headers.authorization" or "body.user.profile.age"
  message: string;
  expected: unknown; // reference SDK value (or language A)
  actual: unknown;   // comparing SDK value (or language B)
  sdkA: string;
  sdkB: string;
}

export interface ClassificationResult {
  category: DivergenceCategory;
  severity: DiffSeverity;
  message: string;
}


export interface ComparisonResult {
  hasDivergence: boolean;
  executionError?: string;
  diffs: SemanticDiff[];
  sdkRequests: Record<string, NormalizedRequest>;
}
