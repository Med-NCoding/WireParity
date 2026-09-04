#!/usr/bin/env python3
"""
Minimal external-user Python SDK runner for WireParity.

WireParity stdin/stdout IPC protocol:
1. Reads a single JSON line from stdin:
   { "operationId": "...", "inputs": { ... }, "targetUrl": "..." }
2. Translates WireParity IR values to native values and executes the HTTP call.
3. Writes a single JSON line to stdout:
   { "success": true } or { "success": false, "error": "..." }
"""

import json
import sys
import urllib.parse
import urllib.request


def ir_value_to_py(val):
    if not isinstance(val, dict):
        return val
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


def execute_operation(req):
    operation_id = req["operationId"]
    inputs = req.get("inputs", {})
    target_url = req["targetUrl"].rstrip("/")

    if operation_id == "listPets":
        query_params = inputs.get("queryParams", {})
        limit = ir_value_to_py(query_params.get("limit")) if "limit" in query_params else None
        url = f"{target_url}/pets"
        if limit is not None:
            url += f"?limit={urllib.parse.quote(str(limit))}"
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request):
            pass

    elif operation_id == "createPet":
        body = ir_value_to_py(inputs.get("body", {}))
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"{target_url}/pets",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request):
            pass

    elif operation_id == "getPetById":
        path_params = inputs.get("pathParams", {})
        pet_id = ir_value_to_py(path_params.get("petId", ""))
        quoted_id = urllib.parse.quote(str(pet_id), safe="")
        request = urllib.request.Request(f"{target_url}/pets/{quoted_id}", method="GET")
        with urllib.request.urlopen(request):
            pass

    else:
        raise ValueError(f"Unsupported operation: {operation_id}")


def main():
    line = sys.stdin.read().strip()
    if not line:
        sys.stdout.write(json.dumps({"success": False, "error": "Empty input"}) + "\n")
        return

    try:
        req = json.loads(line)
        execute_operation(req)
        sys.stdout.write(json.dumps({"success": True}) + "\n")
    except Exception as e:
        sys.stdout.write(json.dumps({"success": False, "error": str(e)}) + "\n")


if __name__ == "__main__":
    main()
