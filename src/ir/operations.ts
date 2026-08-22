/**
 * WireParity Intermediate Representation (IR) - Operations & Parameters
 *
 * Provides a language-neutral model for API operations, parameters,
 * request bodies, and authentication schemes.
 */

import type { IRSchema } from "./values.js";

export type IRHttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export type IRParameterLocation = "path" | "query" | "header" | "cookie";

export type IRQueryStyle = "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
export type IRPathStyle = "simple" | "matrix" | "label";
export type IRHeaderStyle = "simple";

export type IRParameterStyle = IRQueryStyle | IRPathStyle | IRHeaderStyle;

export interface IRParameter {
  name: string;
  in: IRParameterLocation;
  required: boolean;
  schema: IRSchema;
  description?: string;
  style?: IRParameterStyle;
  explode?: boolean;
  deprecated?: boolean;
}

export interface IRRequestBody {
  description?: string;
  required: boolean;
  content: Record<string, IRMediaType>;
}

export interface IRMediaType {
  schema: IRSchema;
  example?: unknown;
}

export type IRAuthType = "apiKey" | "http" | "oauth2" | "openIdConnect";

export interface IRAuthScheme {
  type: IRAuthType;
  name?: string; // e.g. header name for apiKey
  in?: "header" | "query" | "cookie";
  scheme?: string; // e.g. 'bearer', 'basic'
  bearerFormat?: string;
}

export interface IROperation {
  id: string; // e.g. "getUserById" or generated from method+path
  method: IRHttpMethod;
  path: string; // e.g. "/v1/users/{id}"
  summary?: string;
  description?: string;
  parameters: IRParameter[];
  requestBody?: IRRequestBody;
  auth?: IRAuthScheme[];
  tags?: string[];
  deprecated?: boolean;
}

export interface IRDocument {
  title: string;
  version: string;
  servers: string[];
  operations: IROperation[];
}
