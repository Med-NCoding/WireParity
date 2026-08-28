#!/usr/bin/env node
/**
 * WireParity Go SDK Runner Worker (Step 8.2)
 *
 * Implements the Go SDK runner child process protocol:
 * 1. Reads a single JSON line IPCRequest from stdin { operationId, inputs, targetUrl }
 * 2. Applies Go struct & PascalCase mapping to translate OperationInputs
 * 3. Executes the target SDK method against the capture server at targetUrl
 * 4. Writes a single JSON line IPCResponse to stdout { success, error?, ... }
 */

import * as readline from "node:readline";

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

export function toPascalCase(str: string): string {
  if (!str) return "";
  const words = str
    .replace(/[-_.\s]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/);

  return words
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// PetStore Go SDK Client Emulation
// ---------------------------------------------------------------------------

export class PetStoreGoClient {
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

  async createPet(params: { pet?: unknown; body?: unknown }): Promise<Response> {
    const url = `${this.basePath}/pets`;
    const payload = params.pet ?? params.body;
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

  async updatePet(params: { petId: string; pet?: unknown; body?: unknown }): Promise<Response> {
    const url = `${this.basePath}/pets/${encodeURIComponent(params.petId)}`;
    const payload = params.pet ?? params.body;
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

  async placeOrder(params: { order?: unknown; body?: unknown }): Promise<Response> {
    const url = `${this.basePath}/store/orders`;
    const payload = params.order ?? params.body;
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
}

// ---------------------------------------------------------------------------
// Invocation Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchOperation(
  operationId: string,
  inputs: OperationInputs,
  targetUrl: string
): Promise<Response> {
  const client = new PetStoreGoClient(targetUrl);

  const rawPath: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs.pathParams ?? {})) {
    rawPath[k] = irValueToJs(v);
  }

  const rawQuery: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs.queryParams ?? {})) {
    rawQuery[k] = irValueToJs(v);
  }

  const rawHeader: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs.headerParams ?? {})) {
    rawHeader[k] = irValueToJs(v);
  }

  const bodyVal = inputs.body !== undefined ? irValueToJs(inputs.body) : undefined;

  switch (operationId) {
    case "listPets":
      return client.listPets({
        limit: rawQuery["limit"] as number | undefined,
        status: rawQuery["status"] as string[] | undefined,
        tags: rawQuery["tags"] as string[] | undefined,
        acceptLanguage: rawHeader["Accept-Language"] as string | undefined,
      });

    case "createPet":
      return client.createPet({ body: bodyVal });

    case "getPetById":
      return client.getPetById({
        petId: String(rawPath["petId"] ?? ""),
        include: rawQuery["include"] as string[] | undefined,
      });

    case "updatePet":
      return client.updatePet({
        petId: String(rawPath["petId"] ?? ""),
        body: bodyVal,
      });

    case "deletePet":
      return client.deletePet({
        petId: String(rawPath["petId"] ?? ""),
      });

    case "placeOrder":
      return client.placeOrder({ body: bodyVal });

    case "getOrderById":
      return client.getOrderById({
        orderId: (rawPath["orderId"] as string | number) ?? "",
        xRequestId: rawHeader["X-Request-ID"] as string | undefined,
      });

    case "deleteOrder":
      return client.deleteOrder({
        orderId: (rawPath["orderId"] as string | number) ?? "",
      });

    default:
      throw new Error(`Unknown operationId: ${operationId}`);
  }
}

// ---------------------------------------------------------------------------
// Main Subprocess Loop (IPC)
// ---------------------------------------------------------------------------

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let req: IPCRequest;
    try {
      req = JSON.parse(line.trim()) as IPCRequest;
    } catch (e) {
      const resp: IPCResponse = {
        success: false,
        error: `Failed to parse IPCRequest JSON: ${e instanceof Error ? e.message : String(e)}`,
      };
      process.stdout.write(JSON.stringify(resp) + "\n");
      process.exit(1);
    }

    try {
      await dispatchOperation(req.operationId, req.inputs, req.targetUrl);
      const resp: IPCResponse = { success: true };
      process.stdout.write(JSON.stringify(resp) + "\n");
      process.exit(0);
    } catch (err) {
      const resp: IPCResponse = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      process.stdout.write(JSON.stringify(resp) + "\n");
      process.exit(1);
    }
  }
}

// Only execute main when invoked as a standalone script
const isMain = process.argv[1]?.endsWith("go_runner.ts") || process.argv[1]?.endsWith("go_runner.js");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
  });
}
