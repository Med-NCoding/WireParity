import type {
  IRDocument,
  IRHttpMethod,
  IROperation,
  IRParameter,
  IRParameterLocation,
  IRParameterStyle,
  IRRequestBody,
  IRSchema,
  IRAuthScheme,
} from "../ir/index.js";
import { OpenAPIRefResolver } from "./resolver.js";
import type {
  MediaTypeRaw,
  OpenAPISpecRaw,
  OperationRaw,
  ParameterRaw,
  RefRaw,
  RequestBodyRaw,
  SchemaRaw,
} from "./types.js";

const HTTP_METHODS: IRHttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

/**
 * Structured error thrown when an OpenAPI spec fails root validation.
 * Contains a `field` indicating which spec field caused the failure.
 */
export class OpenAPIParseError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = "OpenAPIParseError";
  }
}

/**
 * Validates the root structure of an OpenAPI 3.0.x or 3.1.x specification.
 * Throws OpenAPIParseError with a descriptive message and field reference on any violation.
 */
export function validateOpenAPIRoot(rawSpec: unknown): OpenAPISpecRaw {
  if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) {
    throw new OpenAPIParseError(
      "Invalid OpenAPI specification: root must be a non-null object",
      "root"
    );
  }

  const doc = rawSpec as Record<string, unknown>;

  // Validate 'openapi' version field
  if (!("openapi" in doc)) {
    throw new OpenAPIParseError(
      "Missing required field 'openapi' (expected \"3.0.x\" or \"3.1.x\")",
      "openapi"
    );
  }
  if (typeof doc.openapi !== "string") {
    throw new OpenAPIParseError(
      "Field 'openapi' must be a string (expected \"3.0.x\" or \"3.1.x\")",
      "openapi"
    );
  }
  const versionMatch = /^(3\.0\.\d+|3\.1\.\d+)$/.exec(doc.openapi);
  if (!versionMatch) {
    throw new OpenAPIParseError(
      `Unsupported OpenAPI version "${doc.openapi}". WireParity supports OpenAPI 3.0.x and 3.1.x only.`,
      "openapi"
    );
  }

  // Validate 'info' block
  if (!("info" in doc) || !doc.info || typeof doc.info !== "object" || Array.isArray(doc.info)) {
    throw new OpenAPIParseError(
      "Missing or invalid required field 'info'",
      "info"
    );
  }
  const info = doc.info as Record<string, unknown>;

  if (!("title" in info) || typeof info.title !== "string" || info.title.trim() === "") {
    throw new OpenAPIParseError(
      "Missing or empty required field 'info.title'",
      "info.title"
    );
  }
  if (!("version" in info) || typeof info.version !== "string" || info.version.trim() === "") {
    throw new OpenAPIParseError(
      "Missing or empty required field 'info.version'",
      "info.version"
    );
  }

  return rawSpec as OpenAPISpecRaw;
}

/**
 * Parses an OpenAPI 3.0 or 3.1 specification object into WireParity IRDocument.
 * Performs strict root validation before processing; throws OpenAPIParseError on failure.
 */
export function parseOpenAPISpec(rawSpec: unknown): IRDocument {
  const doc = validateOpenAPIRoot(rawSpec);

  const resolver = new OpenAPIRefResolver(doc);
  const servers = doc.servers?.map((s) => s.url) ?? ["/"];
  const operations: IROperation[] = [];

  if (doc.paths && typeof doc.paths === "object") {
    for (const [pathKey, pathItemRaw] of Object.entries(doc.paths)) {
      if (!pathItemRaw || typeof pathItemRaw !== "object") continue;

      const pathLevelParams = (pathItemRaw.parameters ?? []).map((p) =>
        resolver.resolve<ParameterRaw>(p)
      );

      for (const methodKey of Object.keys(pathItemRaw)) {
        const upperMethod = methodKey.toUpperCase() as IRHttpMethod;
        if (!HTTP_METHODS.includes(upperMethod)) {
          continue;
        }

        const opRaw = (pathItemRaw as Record<string, unknown>)[methodKey] as OperationRaw | undefined;
        if (!opRaw || typeof opRaw !== "object") continue;

        const operation = parseOperation(
          pathKey,
          upperMethod,
          opRaw,
          pathLevelParams,
          doc,
          resolver
        );
        operations.push(operation);
      }
    }
  }

  return {
    title: doc.info.title,
    version: doc.info.version ?? "1.0.0",
    servers,
    operations,
  };
}

function parseOperation(
  path: string,
  method: IRHttpMethod,
  opRaw: OperationRaw,
  pathLevelParams: ParameterRaw[],
  doc: OpenAPISpecRaw,
  resolver: OpenAPIRefResolver
): IROperation {
  const operationId =
    opRaw.operationId ??
    `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")}`;

  // Combine path-level and operation-level parameters (operation overrides by name + in)
  const opLevelParams = (opRaw.parameters ?? []).map((p) => resolver.resolve<ParameterRaw>(p));
  const paramMap = new Map<string, ParameterRaw>();

  for (const p of pathLevelParams) {
    paramMap.set(`${p.in}:${p.name}`, p);
  }
  for (const p of opLevelParams) {
    paramMap.set(`${p.in}:${p.name}`, p);
  }

  const parameters: IRParameter[] = [];
  for (const rawParam of paramMap.values()) {
    parameters.push(parseParameter(rawParam, resolver));
  }

  let requestBody: IRRequestBody | undefined;
  if (opRaw.requestBody) {
    const resolvedBody = resolver.resolve<RequestBodyRaw>(opRaw.requestBody);
    requestBody = parseRequestBody(resolvedBody, resolver);
  }

  const auth = parseSecurity(opRaw.security ?? doc.security, doc, resolver);

  return {
    id: operationId,
    method,
    path,
    summary: opRaw.summary,
    description: opRaw.description,
    tags: opRaw.tags,
    deprecated: opRaw.deprecated,
    parameters,
    requestBody,
    auth,
  };
}

/**
 * Returns the default serialization style for a parameter location per OpenAPI 3.x spec:
 *   - path   → simple
 *   - query  → form
 *   - header → simple
 *   - cookie → form
 */
function defaultStyleFor(location: string): IRParameterStyle {
  switch (location) {
    case "query":
    case "cookie":
      return "form";
    case "path":
    case "header":
    default:
      return "simple";
  }
}

/**
 * Returns the default explode value for a given serialization style per OpenAPI 3.x spec:
 *   - form style  → true  (query / cookie)
 *   - other styles → false (simple, label, matrix, …)
 */
function defaultExplodeFor(style: IRParameterStyle): boolean {
  return style === "form";
}

function parseParameter(paramRaw: ParameterRaw, resolver: OpenAPIRefResolver): IRParameter {
  const schemaRaw = paramRaw.schema ? resolver.resolve<SchemaRaw>(paramRaw.schema) : { type: "string" };
  const schema = parseSchema(schemaRaw, resolver);

  const location = paramRaw.in as IRParameterLocation;
  const style: IRParameterStyle =
    (paramRaw.style as IRParameterStyle | undefined) ?? defaultStyleFor(location);
  const explode: boolean = paramRaw.explode ?? defaultExplodeFor(style);

  return {
    name: paramRaw.name,
    in: location,
    required: paramRaw.required ?? (location === "path"),
    description: paramRaw.description,
    style,
    explode,
    deprecated: paramRaw.deprecated,
    schema,
  };
}

function parseRequestBody(bodyRaw: RequestBodyRaw, resolver: OpenAPIRefResolver): IRRequestBody {
  const content: Record<string, { schema: IRSchema; example?: unknown }> = {};

  for (const [mediaType, mediaRaw] of Object.entries(bodyRaw.content ?? {})) {
    const rawContent = mediaRaw as MediaTypeRaw;
    const schemaRaw = rawContent.schema ? resolver.resolve<SchemaRaw>(rawContent.schema) : { type: "any" };
    content[mediaType] = {
      schema: parseSchema(schemaRaw, resolver),
      example: rawContent.example,
    };
  }

  return {
    description: bodyRaw.description,
    required: bodyRaw.required ?? false,
    content,
  };
}

function parseSchema(schemaRaw: SchemaRaw | RefRaw, resolver: OpenAPIRefResolver): IRSchema {
  const s = resolver.resolve<SchemaRaw>(schemaRaw);

  // Handle allOf merging — safe documented subset (Step 2.4):
  //   • Object property union (later sub-schemas win on duplicate property names)
  //   • Required array union
  //   • Format intersection (kept only when all concrete sub-schemas agree)
  //   • Conflicting concrete types → OpenAPIParseError
  //   • Nullable propagated if any sub-schema is nullable
  if (s.allOf && Array.isArray(s.allOf) && s.allOf.length > 0) {
    const mergedProps: Record<string, IRSchema> = {};
    const mergedRequired = new Set<string>();
    let isNullable = s.nullable ?? false;
    const concreteTypes: string[] = [];
    const formats: string[] = [];

    for (const sub of s.allOf) {
      const parsedSub = parseSchema(sub, resolver);

      // Collect concrete types (exclude "any" and "null" which carry no type conflict)
      if (parsedSub.type !== "any" && parsedSub.type !== "null") {
        concreteTypes.push(parsedSub.type);
      }

      if (parsedSub.type === "object") {
        // Union object properties — later sub-schema wins on duplicate key
        for (const [propName, propSchema] of Object.entries(parsedSub.properties)) {
          mergedProps[propName] = propSchema;
        }
        if (parsedSub.required) {
          for (const req of parsedSub.required) mergedRequired.add(req);
        }
      }

      // Collect formats for intersection
      if ("format" in parsedSub && typeof parsedSub.format === "string") {
        formats.push(parsedSub.format);
      }

      if ("nullable" in parsedSub && parsedSub.nullable) isNullable = true;
    }

    // Conflicting type validation: throw when two different concrete types appear
    const uniqueTypes = Array.from(new Set(concreteTypes));
    if (uniqueTypes.length > 1) {
      throw new OpenAPIParseError(
        `allOf schema conflict: incompatible types [${uniqueTypes.join(", ")}] cannot be merged`,
        "allOf"
      );
    }

    // Format intersection: keep only when every sub-schema that declares a format agrees
    const mergedFormat =
      formats.length > 0 && formats.every((f) => f === formats[0]) ? formats[0] : undefined;

    // Parent-level properties/required applied last (parent overrides sub-schema props)
    if (s.properties) {
      for (const [propName, propRaw] of Object.entries(s.properties)) {
        mergedProps[propName] = parseSchema(propRaw, resolver);
      }
    }
    if (s.required) {
      for (const req of s.required) mergedRequired.add(req);
    }

    const mergedResult: IRSchema = {
      type: "object",
      properties: mergedProps,
      required: mergedRequired.size > 0 ? Array.from(mergedRequired) : undefined,
      nullable: isNullable,
      description: s.description,
    };

    // Attach intersected format when present (requires casting since IRObjectSchema has no format)
    if (mergedFormat) {
      (mergedResult as unknown as Record<string, unknown>)["format"] = mergedFormat;
    }

    return mergedResult;
  }

  // OpenAPI 3.1: type may be an array e.g. ["string", "null"] or ["integer", "null"]
  let typeStr: string | undefined;
  let isNullable = s.nullable ?? false;

  if (Array.isArray(s.type)) {
    // 3.1 style: null in the type array means nullable
    if (s.type.includes("null")) {
      isNullable = true;
    }
    // Pick the first non-null type as the canonical type
    typeStr = s.type.find((t) => t !== "null");
  } else {
    typeStr = s.type;
  }

  // Infer object if properties exist without type
  if (!typeStr && s.properties) {
    typeStr = "object";
  }

  switch (typeStr) {
    case "string":
      return {
        type: "string",
        format: s.format,
        enum: s.enum as string[] | undefined,
        pattern: s.pattern,
        minLength: s.minLength,
        maxLength: s.maxLength,
        nullable: isNullable,
        description: s.description,
      };

    case "integer": {
      // OpenAPI 3.1 uses numeric exclusiveMinimum/exclusiveMaximum instead of boolean
      const exMin = typeof s.exclusiveMinimum === "number"
        ? s.exclusiveMinimum
        : (typeof s.exclusiveMinimum === "boolean" ? s.exclusiveMinimum : undefined);
      const exMax = typeof s.exclusiveMaximum === "number"
        ? s.exclusiveMaximum
        : (typeof s.exclusiveMaximum === "boolean" ? s.exclusiveMaximum : undefined);
      return {
        type: "integer",
        format: s.format,
        enum: s.enum as number[] | undefined,
        minimum: s.minimum,
        maximum: s.maximum,
        exclusiveMinimum: exMin,
        exclusiveMaximum: exMax,
        multipleOf: s.multipleOf,
        nullable: isNullable,
        description: s.description,
      };
    }

    case "number": {
      const exMin = typeof s.exclusiveMinimum === "number"
        ? s.exclusiveMinimum
        : (typeof s.exclusiveMinimum === "boolean" ? s.exclusiveMinimum : undefined);
      const exMax = typeof s.exclusiveMaximum === "number"
        ? s.exclusiveMaximum
        : (typeof s.exclusiveMaximum === "boolean" ? s.exclusiveMaximum : undefined);
      return {
        type: "number",
        format: s.format,
        enum: s.enum as number[] | undefined,
        minimum: s.minimum,
        maximum: s.maximum,
        exclusiveMinimum: exMin,
        exclusiveMaximum: exMax,
        multipleOf: s.multipleOf,
        nullable: isNullable,
        description: s.description,
      };
    }

    case "boolean":
      return {
        type: "boolean",
        nullable: isNullable,
        description: s.description,
      };

    case "null":
      return {
        type: "null",
        description: s.description,
      };

    case "array": {
      const itemsRaw = s.items ? resolver.resolve<SchemaRaw>(s.items) : { type: "any" };
      return {
        type: "array",
        items: parseSchema(itemsRaw, resolver),
        minItems: s.minItems,
        maxItems: s.maxItems,
        uniqueItems: s.uniqueItems,
        nullable: isNullable,
        description: s.description,
      };
    }

    case "object": {
      const properties: Record<string, IRSchema> = {};
      if (s.properties) {
        for (const [key, propSchemaRaw] of Object.entries(s.properties)) {
          properties[key] = parseSchema(propSchemaRaw, resolver);
        }
      }

      let additionalProperties: boolean | IRSchema | undefined;
      if (typeof s.additionalProperties === "boolean") {
        additionalProperties = s.additionalProperties;
      } else if (s.additionalProperties && typeof s.additionalProperties === "object") {
        additionalProperties = parseSchema(s.additionalProperties, resolver);
      }

      return {
        type: "object",
        properties,
        required: s.required,
        additionalProperties,
        nullable: isNullable,
        description: s.description,
      };
    }

    default:
      return {
        type: "any",
        nullable: isNullable,
        description: s.description,
      };
  }
}

function parseSecurity(
  securityRequirements: Array<Record<string, string[]>> | undefined,
  doc: OpenAPISpecRaw,
  resolver: OpenAPIRefResolver
): IRAuthScheme[] | undefined {
  if (!securityRequirements || securityRequirements.length === 0) {
    return undefined;
  }

  const securitySchemes = doc.components?.securitySchemes;
  if (!securitySchemes) return undefined;

  const authSchemes: IRAuthScheme[] = [];

  for (const req of securityRequirements) {
    for (const schemeName of Object.keys(req)) {
      const rawScheme = securitySchemes[schemeName];
      if (!rawScheme) continue;
      const resolved = resolver.resolve(rawScheme);
      authSchemes.push({
        type: resolved.type,
        name: resolved.name,
        in: resolved.in,
        scheme: resolved.scheme,
        bearerFormat: resolved.bearerFormat,
      });
    }
  }

  return authSchemes.length > 0 ? authSchemes : undefined;
}
