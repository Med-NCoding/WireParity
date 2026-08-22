/**
 * Types representing raw OpenAPI v3.0 / v3.1 object structure.
 */

export interface OpenAPISpecRaw {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, PathItemRaw>;
  components?: {
    schemas?: Record<string, SchemaRaw>;
    parameters?: Record<string, ParameterRaw>;
    requestBodies?: Record<string, RequestBodyRaw>;
    securitySchemes?: Record<string, SecuritySchemeRaw>;
  };
  security?: Array<Record<string, string[]>>;
}

export interface PathItemRaw {
  summary?: string;
  description?: string;
  get?: OperationRaw;
  put?: OperationRaw;
  post?: OperationRaw;
  delete?: OperationRaw;
  options?: OperationRaw;
  head?: OperationRaw;
  patch?: OperationRaw;
  trace?: OperationRaw;
  parameters?: Array<ParameterRaw | RefRaw>;
}

export interface OperationRaw {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<ParameterRaw | RefRaw>;
  requestBody?: RequestBodyRaw | RefRaw;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

export interface ParameterRaw {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  style?: string;
  explode?: boolean;
  schema?: SchemaRaw | RefRaw;
}

export interface RequestBodyRaw {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeRaw>;
}

export interface MediaTypeRaw {
  schema?: SchemaRaw | RefRaw;
  example?: unknown;
}

export interface SecuritySchemeRaw {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string;
  in?: "header" | "query" | "cookie";
  scheme?: string;
  bearerFormat?: string;
}

export interface SchemaRaw {
  type?: string | string[];
  format?: string;
  nullable?: boolean;
  enum?: unknown[];
  items?: SchemaRaw | RefRaw;
  properties?: Record<string, SchemaRaw | RefRaw>;
  required?: string[];
  additionalProperties?: boolean | SchemaRaw | RefRaw;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  allOf?: Array<SchemaRaw | RefRaw>;
  oneOf?: Array<SchemaRaw | RefRaw>;
  anyOf?: Array<SchemaRaw | RefRaw>;
  description?: string;
  default?: unknown;
}

export interface RefRaw {
  $ref: string;
}

export function isRef(obj: unknown): obj is RefRaw {
  return typeof obj === "object" && obj !== null && "$ref" in obj && typeof (obj as RefRaw).$ref === "string";
}
