import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { CapturedRequest, CaptureServer, CaptureServerOptions } from "./types.js";

export async function startCaptureServer(options: CaptureServerOptions = {}): Promise<CaptureServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const requests: CapturedRequest[] = [];
  let requestCounter = 0;

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      requestCounter += 1;
      const rawUrl = req.url ?? "/";
      const parsedUrl = new URL(rawUrl, `http://${host}`);

      const query: Record<string, string | string[]> = {};
      for (const [key, value] of parsedUrl.searchParams.entries()) {
        if (key in query) {
          const existing = query[key];
          if (Array.isArray(existing)) {
            existing.push(value);
          } else if (typeof existing === "string") {
            query[key] = [existing, value];
          }
        } else {
          query[key] = value;
        }
      }

      const bodyBuffer = Buffer.concat(chunks);
      const body = bodyBuffer.length > 0 ? bodyBuffer.toString("utf-8") : null;

      let jsonBody: unknown | null = null;
      if (body !== null) {
        try {
          jsonBody = JSON.parse(body);
        } catch {
          jsonBody = null;
        }
      }

      const captured: CapturedRequest = {
        id: `req_${requestCounter}`,
        timestamp: Date.now(),
        method: req.method ?? "GET",
        path: parsedUrl.pathname,
        query,
        headers: req.headers,
        body,
        jsonBody,
      };

      requests.push(captured);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: captured.id }));
    });

    req.on("error", (err: Error) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => {
      resolve();
    });
    server.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const boundPort = address.port;
  const boundHost = address.address;
  const url = `http://${boundHost}:${boundPort}`;

  return {
    url,
    port: boundPort,
    host: boundHost,
    getRequests: () => [...requests],
    clear: () => {
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
