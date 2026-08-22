/**
 * Canonical normalized request representation for semantic comparison.
 */

export interface NormalizedRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  headers: Record<string, string>;
  body: unknown | null;
  rawBody: string | null;
}

export interface NormalizationOptions {
  ignoredHeaders?: string[];
  stripTrailingSlash?: boolean;
  normalizeFloats?: boolean;
  sortQueryArrays?: boolean;
}

export const DEFAULT_IGNORED_HEADERS = [
  "user-agent",
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-wireparity-run-id",
];
