package main

/**
 * Minimal external-user Go SDK runner for WireParity.
 *
 * WireParity stdin/stdout IPC protocol:
 * 1. Reads a single JSON line from stdin:
 *    { "operationId": "...", "inputs": { ... }, "targetUrl": "..." }
 * 2. Translates WireParity IR values to native values and executes the HTTP call.
 * 3. Writes a single JSON line to stdout:
 *    { "success": true } or { "success": false, "error": "..." }
 */

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type IRValue struct {
	Kind   string              `json:"kind"`
	Value  interface{}         `json:"value,omitempty"`
	Items  []IRValue           `json:"items,omitempty"`
	Fields map[string]IRValue  `json:"fields,omitempty"`
}

type OperationInputs struct {
	PathParams   map[string]IRValue `json:"pathParams"`
	QueryParams  map[string]IRValue `json:"queryParams"`
	HeaderParams map[string]IRValue `json:"headerParams"`
	Body         *IRValue           `json:"body,omitempty"`
}

type IPCRequest struct {
	OperationID string          `json:"operationId"`
	Inputs      OperationInputs `json:"inputs"`
	TargetURL   string          `json:"targetUrl"`
}

type IPCResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func irValueToNative(v IRValue) interface{} {
	switch v.Kind {
	case "string", "date", "date-time", "enum":
		return fmt.Sprintf("%v", v.Value)
	case "integer", "number", "boolean":
		return v.Value
	case "null":
		return nil
	case "array":
		items := make([]interface{}, len(v.Items))
		for i, item := range v.Items {
			items[i] = irValueToNative(item)
		}
		return items
	case "object":
		fields := make(map[string]interface{})
		for k, item := range v.Fields {
			fields[k] = irValueToNative(item)
		}
		return fields
	default:
		return v.Value
	}
}

func executeOperation(req IPCRequest) error {
	baseURL := strings.TrimRight(req.TargetURL, "/")

	switch req.OperationID {
	case "listPets":
		reqURL := fmt.Sprintf("%s/pets", baseURL)
		if limitVal, exists := req.Inputs.QueryParams["limit"]; exists {
			nativeLimit := irValueToNative(limitVal)
			reqURL = fmt.Sprintf("%s?limit=%s", reqURL, url.QueryEscape(fmt.Sprintf("%v", nativeLimit)))
		}
		resp, err := http.Get(reqURL)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body)
		return nil

	case "createPet":
		var bodyObj interface{} = map[string]interface{}{}
		if req.Inputs.Body != nil {
			bodyObj = irValueToNative(*req.Inputs.Body)
		}
		bodyBytes, err := json.Marshal(bodyObj)
		if err != nil {
			return err
		}
		resp, err := http.Post(fmt.Sprintf("%s/pets", baseURL), "application/json", bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body)
		return nil

	case "getPetById":
		petID := ""
		if idVal, exists := req.Inputs.PathParams["petId"]; exists {
			petID = fmt.Sprintf("%v", irValueToNative(idVal))
		}
		reqURL := fmt.Sprintf("%s/pets/%s", baseURL, url.PathEscape(petID))
		resp, err := http.Get(reqURL)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body)
		return nil

	default:
		return fmt.Errorf("unsupported operation: %s", req.OperationID)
	}
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		writeResponse(IPCResponse{Success: false, Error: "Empty input on stdin"})
		return
	}

	line := scanner.Bytes()
	var req IPCRequest
	if err := json.Unmarshal(line, &req); err != nil {
		writeResponse(IPCResponse{Success: false, Error: fmt.Sprintf("invalid IPCRequest JSON: %v", err)})
		return
	}

	if err := executeOperation(req); err != nil {
		writeResponse(IPCResponse{Success: false, Error: err.Error()})
		return
	}

	writeResponse(IPCResponse{Success: true})
}

func writeResponse(resp IPCResponse) {
	bytes, _ := json.Marshal(resp)
	os.Stdout.Write(bytes)
	os.Stdout.WriteString("\n")
}
