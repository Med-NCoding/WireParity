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
 * Parses an OpenAPI 3.0 or 3.1 specification object into WireParity IRDocument.
 */
export function parseOpenAPISpec(rawSpec: unknown): IRDocument {
  if (!rawSpec || typeof rawSpec !== "object") {
    throw new Error("Invalid OpenAPI specification: expected an object");
  }

  const doc = rawSpec as OpenAPISpecRaw;
  if (!doc.openapi || typeof doc.openapi !== "string") {
    throw new Error("Missing or invalid 'openapi' version field in specification");
  }

  if (!doc.info || !doc.info.title) {
    throw new Error("Missing 'info.title' in OpenAPI specification");
  }

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

function parseParameter(paramRaw: ParameterRaw, resolver: OpenAPIRefResolver): IRParameter {
  const schemaRaw = paramRaw.schema ? resolver.resolve<SchemaRaw>(paramRaw.schema) : { type: "string" };
  const schema = parseSchema(schemaRaw, resolver);

  return {
    name: paramRaw.name,
    in: paramRaw.in as IRParameterLocation,
    required: paramRaw.required ?? (paramRaw.in === "path"),
    description: paramRaw.description,
    style: paramRaw.style as IRParameterStyle | undefined,
    explode: paramRaw.explode,
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

  // Handle allOf merging
  if (s.allOf && Array.isArray(s.allOf) && s.allOf.length > 0) {
    const mergedProps: Record<string, IRSchema> = {};
    const mergedRequired = new Set<string>();
    let isNullable = s.nullable ?? false;

    for (const sub of s.allOf) {
      const parsedSub = parseSchema(sub, resolver);
      if (parsedSub.type === "object") {
        for (const [propName, propSchema] of Object.entries(parsedSub.properties)) {
          mergedProps[propName] = propSchema;
        }
        if (parsedSub.required) {
          for (const req of parsedSub.required) mergedRequired.add(req);
        }
      }
      if ("nullable" in parsedSub && parsedSub.nullable) isNullable = true;
    }

    // Merge direct properties if any
    if (s.properties) {
      for (const [propName, propRaw] of Object.entries(s.properties)) {
        mergedProps[propName] = parseSchema(propRaw, resolver);
      }
    }
    if (s.required) {
      for (const req of s.required) mergedRequired.add(req);
    }

    return {
      type: "object",
      properties: mergedProps,
      required: mergedRequired.size > 0 ? Array.from(mergedRequired) : undefined,
      nullable: isNullable,
    };
  }

  // OpenAPI 3.1 type array (e.g. `type: ["string", "null"]`)
  let typeStr: string | undefined;
  let isNullable = s.nullable ?? false;

  if (Array.isArray(s.type)) {
    if (s.type.includes("null")) {
      isNullable = true;
    }
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
      };

    case "integer":
      return {
        type: "integer",
        format: s.format,
        enum: s.enum as number[] | undefined,
        minimum: s.minimum,
        maximum: s.maximum,
        exclusiveMinimum: typeof s.exclusiveMinimum === "boolean" ? s.exclusiveMinimum : undefined,
        exclusiveMaximum: typeof s.exclusiveMaximum === "boolean" ? s.exclusiveMaximum : undefined,
        multipleOf: s.multipleOf,
        nullable: isNullable,
      };

    case "number":
      return {
        type: "number",
        format: s.format,
        enum: s.enum as number[] | undefined,
        minimum: s.minimum,
        maximum: s.maximum,
        exclusiveMinimum: typeof s.exclusiveMinimum === "boolean" ? s.exclusiveMinimum : undefined,
        exclusiveMaximum: typeof s.exclusiveMaximum === "boolean" ? s.exclusiveMaximum : undefined,
        multipleOf: s.multipleOf,
        nullable: isNullable,
      };

    case "boolean":
      return {
        type: "boolean",
        nullable: isNullable,
      };

    case "null":
      return {
        type: "null",
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
      };
    }

    default:
      return {
        type: "any",
        nullable: isNullable,
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
