export interface CapturedRequest {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
  body: string | null;
  jsonBody: unknown | null;
}

export interface CaptureServerOptions {
  port?: number;
  host?: string;
}

export interface CaptureServer {
  url: string;
  port: number;
  host: string;
  getRequests(): CapturedRequest[];
  clear(): void;
  close(): Promise<void>;
}
