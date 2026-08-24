#!/usr/bin/env node
/**
 * WireParity TypeScript SDK Runner Worker (Step 3.3)
 *
 * Implements the TypeScript SDK runner child process protocol:
 * 1. Reads a single JSON line IPCRequest from stdin { operationId, inputs, targetUrl }
 * 2. Applies TypeScript named request mapping to translate OperationInputs to SDK parameters
 * 3. Executes the target SDK method against the capture server at targetUrl
 * 4. Writes a single JSON line IPCResponse to stdout { success, error?, ... }
 */

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export type IRValue =
  | { kind: "string"; value: string }
  | { kind: "integer"; value: number }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "date"; value: string }
  | { kind: "date-time"; value: string }
  | { kind: "enum"; value: string }
  | { kind: "array"; items: IRValue[] }
  | { kind: "object"; fields: Record<string, IRValue> };

export type IRValueRecord = Record<string, IRValue>;

export interface OperationInputs {
  pathParams: IRValueRecord;
  queryParams: IRValueRecord;
  headerParams: IRValueRecord;
  cookieParams?: IRValueRecord;
  body?: IRValue;
}

export interface IPCRequest {
  operationId: string;
  inputs: OperationInputs;
  targetUrl: string;
}

export interface IPCResponse {
  success: boolean;
  capturedRequest?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  error?: string;
  stderr?: string;
}

// ---------------------------------------------------------------------------
// Translation & Mapping Utilities
// ---------------------------------------------------------------------------

export function irValueToJs(val: IRValue): unknown {
  switch (val.kind) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
    case "date":
    case "date-time":
    case "enum":
      return val.value;
    case "null":
      return null;
    case "array":
      return val.items.map(irValueToJs);
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val.fields)) {
        obj[k] = irValueToJs(v);
      }
      return obj;
    }
  }
}

export function toCamelCase(str: string): string {
  if (!str) return "";
  const words = str
    .replace(/[-_.\s]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/);

  if (words.length === 0 || !words[0]) return "";

  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function mapToTypeScriptParams(inputs: OperationInputs): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (inputs.pathParams) {
    for (const [k, v] of Object.entries(inputs.pathParams)) {
      params[toCamelCase(k)] = irValueToJs(v);
    }
  }

  if (inputs.queryParams) {
    for (const [k, v] of Object.entries(inputs.queryParams)) {
      params[toCamelCase(k)] = irValueToJs(v);
    }
  }

  if (inputs.headerParams) {
    for (const [k, v] of Object.entries(inputs.headerParams)) {
      params[toCamelCase(k)] = irValueToJs(v);
    }
  }

  if (inputs.cookieParams) {
    for (const [k, v] of Object.entries(inputs.cookieParams)) {
      params[toCamelCase(k)] = irValueToJs(v);
    }
  }

  if (inputs.body !== undefined) {
    params["body"] = irValueToJs(inputs.body);
  }

  return params;
}

// ---------------------------------------------------------------------------
// PetStore TypeScript SDK Client Implementation
// ---------------------------------------------------------------------------

export class PetStoreTSClient {
  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async listPets(params: {
    limit?: number;
    status?: string[];
    tags?: string[];
    acceptLanguage?: string;
  } = {}): Promise<Response> {
    const url = new URL(`${this.basePath}/pets`);
    if (params.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params.status && params.status.length > 0) {
      url.searchParams.set("status", params.status.join(","));
    }
    if (params.tags && params.tags.length > 0) {
      for (const tag of params.tags) {
        url.searchParams.append("tags", tag);
      }
    }

    const headers: Record<string, string> = {};
    if (params.acceptLanguage) {
      headers["Accept-Language"] = params.acceptLanguage;
    }

    return fetch(url.toString(), {
      method: "GET",
      headers,
    });
  }

  async createPet(params: { newPet?: unknown; body?: unknown }): Promise<Response> {
    const url = `${this.basePath}/pets`;
    const payload = params.newPet ?? params.body;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async getPetById(params: { petId: string; include?: string[] }): Promise<Response> {
    const url = new URL(`${this.basePath}/pets/${encodeURIComponent(params.petId)}`);
    if (params.include && params.include.length > 0) {
      url.searchParams.set("include", params.include.join("|"));
    }
    return fetch(url.toString(), {
      method: "GET",
    });
  }

  async updatePet(params: { petId: string; petUpdate?: unknown; body?: unknown }): Promise<Response> {
    const url = `${this.basePath}/pets/${encodeURIComponent(params.petId)}`;
    const payload = params.petUpdate ?? params.body;
    return fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async deletePet(params: { petId: string }): Promise<Response> {
    const url = `${this.basePath}/pets/${encodeURIComponent(params.petId)}`;
    return fetch(url, {
      method: "DELETE",
    });
  }

  async placeOrder(params: { newOrder?: unknown; body?: unknown }): Promise<Response> {
    const url = `${this.basePath}/store/orders`;
    const payload = params.newOrder ?? params.body;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async getOrderById(params: { orderId: number | string; xRequestId?: string }): Promise<Response> {
    const url = `${this.basePath}/store/orders/${encodeURIComponent(String(params.orderId))}`;
    const headers: Record<string, string> = {};
    if (params.xRequestId) {
      headers["X-Request-ID"] = params.xRequestId;
    }
    return fetch(url, {
      method: "GET",
      headers,
    });
  }

  async deleteOrder(params: { orderId: number | string }): Promise<Response> {
    const url = `${this.basePath}/store/orders/${encodeURIComponent(String(params.orderId))}`;
    return fetch(url, {
      method: "DELETE",
    });
  }

  async executeGeneric(
    operationId: string,
    inputsParams: Record<string, unknown>
  ): Promise<Response> {
    const url = new URL(`${this.basePath}/${operationId}`);
    return fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputsParams),
    });
  }
}

// ---------------------------------------------------------------------------
// Execution Logic
// ---------------------------------------------------------------------------

export async function executeTypeScriptRequest(req: IPCRequest): Promise<IPCResponse> {
  const { operationId, inputs, targetUrl } = req;
  const client = new PetStoreTSClient(targetUrl);
  const params = mapToTypeScriptParams(inputs);

  try {
    let res: Response;
    switch (operationId) {
      case "listPets":
        res = await client.listPets(params as Parameters<typeof client.listPets>[0]);
        break;
      case "createPet":
        res = await client.createPet({
          newPet: inputs.body ? irValueToJs(inputs.body) : params["body"],
          body: inputs.body ? irValueToJs(inputs.body) : params["body"],
        });
        break;
      case "getPetById":
        res = await client.getPetById(params as Parameters<typeof client.getPetById>[0]);
        break;
      case "updatePet":
        res = await client.updatePet({
          petId: String(params["petId"] ?? ""),
          petUpdate: inputs.body ? irValueToJs(inputs.body) : params["body"],
          body: inputs.body ? irValueToJs(inputs.body) : params["body"],
        });
        break;
      case "deletePet":
        res = await client.deletePet(params as Parameters<typeof client.deletePet>[0]);
        break;
      case "placeOrder":
        res = await client.placeOrder({
          newOrder: inputs.body ? irValueToJs(inputs.body) : params["body"],
          body: inputs.body ? irValueToJs(inputs.body) : params["body"],
        });
        break;
      case "getOrderById":
        res = await client.getOrderById(params as Parameters<typeof client.getOrderById>[0]);
        break;
      case "deleteOrder":
        res = await client.deleteOrder(params as Parameters<typeof client.deleteOrder>[0]);
        break;
      default:
        res = await client.executeGeneric(operationId, params);
        break;
    }

    return {
      success: true,
      capturedRequest: {
        method: res.statusText,
        url: targetUrl,
        headers: {},
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function main(): Promise<void> {
  let inputBuffer = "";
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (chunk: string) => {
    inputBuffer += chunk;
  });

  process.stdin.on("end", async () => {
    const line = inputBuffer.trim();
    if (!line) {
      const errResponse: IPCResponse = {
        success: false,
        error: "Empty input received on stdin",
      };
      process.stdout.write(JSON.stringify(errResponse) + "\n");
      process.exit(0);
      return;
    }

    try {
      const req = JSON.parse(line) as IPCRequest;
      const resp = await executeTypeScriptRequest(req);
      process.stdout.write(JSON.stringify(resp) + "\n");
      process.exit(0);
    } catch (err: unknown) {
      const errResponse: IPCResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      process.stdout.write(JSON.stringify(errResponse) + "\n");
      process.exit(0);
    }
  });
}

// Auto-run when executed directly from CLI
main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
