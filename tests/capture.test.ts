import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CaptureServer, startCaptureServer } from "../src/index.js";

describe("HTTP Capture Server", () => {
  let server: CaptureServer;

  beforeEach(async () => {
    server = await startCaptureServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("captures a GET request with query params and headers", async () => {
    const response = await fetch(`${server.url}/users/search?role=admin&tag=alpha&tag=beta`, {
      method: "GET",
      headers: {
        "x-api-key": "secret-123",
        "accept": "application/json",
      },
    });

    expect(response.status).toBe(200);
    const resBody = await response.json();
    expect(resBody.ok).toBe(true);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const captured = requests[0];
    expect(captured.method).toBe("GET");
    expect(captured.path).toBe("/users/search");
    expect(captured.query).toEqual({
      role: "admin",
      tag: ["alpha", "beta"],
    });
    expect(captured.headers["x-api-key"]).toBe("secret-123");
    expect(captured.body).toBeNull();
    expect(captured.jsonBody).toBeNull();
  });

  it("captures a POST request with a JSON payload", async () => {
    const payload = {
      username: "alice",
      roles: ["engineer", "lead"],
      settings: { active: true },
    };

    const response = await fetch(`${server.url}/api/v1/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token",
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);

    const requests = server.getRequests();
    expect(requests).toHaveLength(1);

    const captured = requests[0];
    expect(captured.method).toBe("POST");
    expect(captured.path).toBe("/api/v1/users");
    expect(captured.headers["authorization"]).toBe("Bearer test-token");
    expect(captured.body).toBe(JSON.stringify(payload));
    expect(captured.jsonBody).toEqual(payload);
  });

  it("clears captured requests on clear()", async () => {
    await fetch(`${server.url}/ping`);
    expect(server.getRequests()).toHaveLength(1);

    server.clear();
    expect(server.getRequests()).toHaveLength(0);
  });
});
