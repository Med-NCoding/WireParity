#!/usr/bin/env python3
"""
WireParity Python SDK Runner Worker (Step 3.4)

Implements the Python SDK runner child process IPC protocol:
  stdin  <- one JSON line: IPCRequest { operationId, inputs, targetUrl }
  stdout -> one JSON line: IPCResponse { success, error? }

Applies Python-specific invocation mapping (snake_case kwargs) and dispatches
each PetStore operation via stdlib http.client + urllib.parse — the same HTTP
transport used by the generated urllib3-based SDK client.
"""

from __future__ import annotations

import http.client
import json
import sys
import urllib.parse
from typing import Any


# ---------------------------------------------------------------------------
# Type helpers
# ---------------------------------------------------------------------------

IRValue = dict  # { kind: str, value: Any, items?: list, fields?: dict }


def ir_value_to_py(val: IRValue) -> Any:
    """Converts a WireParity IRValue node to a Python primitive / collection."""
    kind = val.get("kind")
    if kind in ("string", "integer", "number", "boolean", "date", "date-time", "enum"):
        return val.get("value")
    if kind == "null":
        return None
    if kind == "array":
        return [ir_value_to_py(item) for item in val.get("items", [])]
    if kind == "object":
        return {k: ir_value_to_py(v) for k, v in val.get("fields", {}).items()}
    return val.get("value")


def to_snake_case(name: str) -> str:
    """Converts parameter names to snake_case (e.g. 'Accept-Language' -> 'accept_language')."""
    import re
    name = re.sub(r"[-.\s]+", "_", name)
    name = re.sub(r"([a-z\d])([A-Z])", r"\1_\2", name)
    return re.sub(r"_+", "_", name).lower().strip("_")


def map_inputs(inputs: dict) -> dict:
    """
    Maps OperationInputs to a flat snake_case kwargs dictionary.
    Returns: { path_params, query_params, header_params, body }
    """
    path_params: dict[str, Any] = {}
    query_params: dict[str, Any] = {}
    header_params: dict[str, Any] = {}
    body: Any = None

    for k, v in inputs.get("pathParams", {}).items():
        path_params[to_snake_case(k)] = ir_value_to_py(v)

    for k, v in inputs.get("queryParams", {}).items():
        query_params[to_snake_case(k)] = ir_value_to_py(v)

    for k, v in inputs.get("headerParams", {}).items():
        # Preserve original header names for HTTP transport
        header_params[k] = ir_value_to_py(v)

    for k, v in inputs.get("cookieParams", {}).items():
        header_params[f"Cookie"] = ir_value_to_py(v)

    if inputs.get("body") is not None:
        body = ir_value_to_py(inputs["body"])

    return {
        "path_params": path_params,
        "query_params": query_params,
        "header_params": header_params,
        "body": body,
    }


# ---------------------------------------------------------------------------
# HTTP client (urllib3-style transport using stdlib http.client)
# ---------------------------------------------------------------------------

def make_request(
    method: str,
    base_url: str,
    path: str,
    query_params: dict | None = None,
    headers: dict | None = None,
    body: Any | None = None,
) -> tuple[int, str]:
    """
    Performs an HTTP request using stdlib http.client.
    Returns (status_code, response_text).
    """
    parsed = urllib.parse.urlparse(base_url)
    host = parsed.hostname
    port = parsed.port

    if query_params:
        # Explode lists as repeated keys; scalars as single keys
        pairs: list[tuple[str, str]] = []
        for k, v in query_params.items():
            if isinstance(v, list):
                for item in v:
                    pairs.append((k, str(item)))
            else:
                pairs.append((k, str(v)))
        qs = urllib.parse.urlencode(pairs)
        full_path = f"{path}?{qs}"
    else:
        full_path = path

    request_headers: dict[str, str] = dict(headers or {})

    body_bytes: bytes | None = None
    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
        request_headers["Content-Length"] = str(len(body_bytes))

    conn = http.client.HTTPConnection(host, port, timeout=10)
    try:
        conn.request(method, full_path, body=body_bytes, headers=request_headers)
        resp = conn.getresponse()
        resp_body = resp.read().decode("utf-8", errors="replace")
        return resp.status, resp_body
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# PetStore Python SDK Client (urllib3 / stdlib equivalent)
# ---------------------------------------------------------------------------

class PetStorePyClient:
    """
    Python SDK client mirroring the generated urllib3-based PetStore SDK.
    Method names and kwargs match the Python OpenAPI Generator output.
    """

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def list_pets(
        self,
        limit: int | None = None,
        status: list[str] | None = None,
        tags: list[str] | None = None,
        accept_language: str | None = None,
    ) -> tuple[int, str]:
        query: dict[str, Any] = {}
        if limit is not None:
            query["limit"] = limit
        if status:
            # explode: false → comma-separated single param
            query["status"] = ",".join(status)
        if tags:
            # explode: true → repeated params, passed as list
            query["tags"] = tags

        headers: dict[str, str] = {}
        if accept_language:
            headers["Accept-Language"] = accept_language

        return make_request("GET", self.base_url, "/pets", query_params=query, headers=headers)

    def create_pet(self, body: Any = None) -> tuple[int, str]:
        return make_request("POST", self.base_url, "/pets", body=body)

    def get_pet_by_id(
        self,
        pet_id: str,
        include: list[str] | None = None,
    ) -> tuple[int, str]:
        path = f"/pets/{urllib.parse.quote(str(pet_id), safe='')}"
        query: dict[str, Any] = {}
        if include:
            # pipeDelimited, explode: false → pipe-joined
            query["include"] = "|".join(include)
        return make_request("GET", self.base_url, path, query_params=query)

    def update_pet(self, pet_id: str, body: Any = None) -> tuple[int, str]:
        path = f"/pets/{urllib.parse.quote(str(pet_id), safe='')}"
        return make_request("PUT", self.base_url, path, body=body)

    def delete_pet(self, pet_id: str) -> tuple[int, str]:
        path = f"/pets/{urllib.parse.quote(str(pet_id), safe='')}"
        return make_request("DELETE", self.base_url, path)

    def place_order(self, body: Any = None) -> tuple[int, str]:
        return make_request("POST", self.base_url, "/store/orders", body=body)

    def get_order_by_id(
        self,
        order_id: int | str,
        x_request_id: str | None = None,
    ) -> tuple[int, str]:
        path = f"/store/orders/{urllib.parse.quote(str(order_id), safe='')}"
        headers: dict[str, str] = {}
        if x_request_id:
            headers["X-Request-ID"] = x_request_id
        return make_request("GET", self.base_url, path, headers=headers)

    def delete_order(self, order_id: int | str) -> tuple[int, str]:
        path = f"/store/orders/{urllib.parse.quote(str(order_id), safe='')}"
        return make_request("DELETE", self.base_url, path)


# ---------------------------------------------------------------------------
# Dispatch: operationId → client method
# ---------------------------------------------------------------------------

def dispatch(operation_id: str, mapped: dict, target_url: str) -> tuple[int, str]:
    client = PetStorePyClient(target_url)
    pp = mapped["path_params"]
    qp = mapped["query_params"]
    hp = mapped["header_params"]
    body = mapped["body"]

    if operation_id == "listPets":
        return client.list_pets(
            limit=qp.get("limit"),
            status=qp.get("status").split(",") if isinstance(qp.get("status"), str) else qp.get("status"),
            tags=qp.get("tags") if isinstance(qp.get("tags"), list) else ([qp["tags"]] if qp.get("tags") else None),
            accept_language=hp.get("Accept-Language"),
        )
    if operation_id == "createPet":
        return client.create_pet(body=body)
    if operation_id == "getPetById":
        include_raw = qp.get("include")
        include = include_raw.split("|") if isinstance(include_raw, str) else include_raw
        return client.get_pet_by_id(
            pet_id=str(pp.get("pet_id", "")),
            include=include,
        )
    if operation_id == "updatePet":
        return client.update_pet(pet_id=str(pp.get("pet_id", "")), body=body)
    if operation_id == "deletePet":
        return client.delete_pet(pet_id=str(pp.get("pet_id", "")))
    if operation_id == "placeOrder":
        return client.place_order(body=body)
    if operation_id == "getOrderById":
        return client.get_order_by_id(
            order_id=pp.get("order_id", ""),
            x_request_id=hp.get("X-Request-ID"),
        )
    if operation_id == "deleteOrder":
        return client.delete_order(order_id=pp.get("order_id", ""))

    # Generic fallback — POST to /<operationId> with body
    return make_request("POST", target_url, f"/{operation_id}", body=body)


# ---------------------------------------------------------------------------
# Main IPC entry point
# ---------------------------------------------------------------------------

def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        resp = {"success": False, "error": "Empty input received on stdin"}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
        return

    try:
        req = json.loads(raw)
    except json.JSONDecodeError as exc:
        resp = {"success": False, "error": f"JSON parse error: {exc}"}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
        return

    operation_id = req.get("operationId", "")
    inputs = req.get("inputs", {})
    target_url = req.get("targetUrl", "")

    try:
        mapped = map_inputs(inputs)
        _status, _body = dispatch(operation_id, mapped, target_url)
        resp = {"success": True}
    except Exception as exc:
        resp = {"success": False, "error": str(exc)}

    sys.stdout.write(json.dumps(resp) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
