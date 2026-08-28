package main

/**
 * WireParity Go SDK Runner Worker (Step 8.2)
 *
 * Implements the Go SDK runner child process IPC protocol:
 *   stdin  <- one JSON line: IPCRequest { operationId, inputs, targetUrl }
 *   stdout -> one JSON line: IPCResponse { success, error? }
 *
 * Applies Go-specific invocation mapping (struct pointers, PascalCase field mapping)
 * and dispatches each PetStore operation via stdlib net/http — the same HTTP transport
 * used by the generated Go SDK client.
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
	"time"
)

// ─── IPC Protocol Structures ──────────────────────────────────────────────────

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
	CookieParams map[string]IRValue `json:"cookieParams,omitempty"`
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

// ─── IR to Native Go Translation ──────────────────────────────────────────────

func irValueToGo(v IRValue) interface{} {
	switch v.Kind {
	case "string", "date", "date-time", "enum":
		if str, ok := v.Value.(string); ok {
			return str
		}
		return fmt.Sprintf("%v", v.Value)
	case "integer", "number":
		return v.Value
	case "boolean":
		return v.Value
	case "null":
		return nil
	case "array":
		result := make([]interface{}, len(v.Items))
		for i, item := range v.Items {
			result[i] = irValueToGo(item)
		}
		return result
	case "object":
		result := make(map[string]interface{})
		for k, f := range v.Fields {
			result[k] = irValueToGo(f)
		}
		return result
	default:
		return v.Value
	}
}

func toStringSlice(val interface{}) []string {
	if val == nil {
		return nil
	}
	if slice, ok := val.([]interface{}); ok {
		res := make([]string, len(slice))
		for i, item := range slice {
			res[i] = fmt.Sprintf("%v", item)
		}
		return res
	}
	if str, ok := val.(string); ok {
		return []string{str}
	}
	return []string{fmt.Sprintf("%v", val)}
}

// ─── PetStore Go SDK Client Emulation ─────────────────────────────────────────

type PetStoreGoClient struct {
	BasePath   string
	HTTPClient *http.Client
}

func NewPetStoreGoClient(basePath string) *PetStoreGoClient {
	return &PetStoreGoClient{
		BasePath: strings.TrimRight(basePath, "/"),
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *PetStoreGoClient) ListPets(queryParams map[string]interface{}, headerParams map[string]interface{}) error {
	reqURL, err := url.Parse(c.BasePath + "/pets")
	if err != nil {
		return err
	}

	q := reqURL.Query()
	if limit, ok := queryParams["limit"]; ok && limit != nil {
		q.Set("limit", fmt.Sprintf("%v", limit))
	}
	if status, ok := queryParams["status"]; ok && status != nil {
		slice := toStringSlice(status)
		if len(slice) > 0 {
			q.Set("status", strings.Join(slice, ","))
		}
	}
	if tags, ok := queryParams["tags"]; ok && tags != nil {
		slice := toStringSlice(tags)
		for _, tag := range slice {
			q.Add("tags", tag)
		}
	}
	reqURL.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", reqURL.String(), nil)
	if err != nil {
		return err
	}

	if lang, ok := headerParams["Accept-Language"]; ok && lang != nil {
		req.Header.Set("Accept-Language", fmt.Sprintf("%v", lang))
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) CreatePet(body interface{}) error {
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", c.BasePath+"/pets", bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) GetPetById(petID string, queryParams map[string]interface{}) error {
	escapedPetID := url.PathEscape(petID)
	reqURL, err := url.Parse(fmt.Sprintf("%s/pets/%s", c.BasePath, escapedPetID))
	if err != nil {
		return err
	}

	if inc, ok := queryParams["include"]; ok && inc != nil {
		slice := toStringSlice(inc)
		if len(slice) > 0 {
			q := reqURL.Query()
			q.Set("include", strings.Join(slice, "|"))
			reqURL.RawQuery = q.Encode()
		}
	}

	req, err := http.NewRequest("GET", reqURL.String(), nil)
	if err != nil {
		return err
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) UpdatePet(petID string, body interface{}) error {
	escapedPetID := url.PathEscape(petID)
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PUT", fmt.Sprintf("%s/pets/%s", c.BasePath, escapedPetID), bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) DeletePet(petID string) error {
	escapedPetID := url.PathEscape(petID)
	req, err := http.NewRequest("DELETE", fmt.Sprintf("%s/pets/%s", c.BasePath, escapedPetID), nil)
	if err != nil {
		return err
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) PlaceOrder(body interface{}) error {
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", c.BasePath+"/store/orders", bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) GetOrderById(orderID string, headerParams map[string]interface{}) error {
	escapedOrderID := url.PathEscape(orderID)
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/store/orders/%s", c.BasePath, escapedOrderID), nil)
	if err != nil {
		return err
	}

	if reqID, ok := headerParams["X-Request-ID"]; ok && reqID != nil {
		req.Header.Set("X-Request-ID", fmt.Sprintf("%v", reqID))
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *PetStoreGoClient) DeleteOrder(orderID string) error {
	escapedOrderID := url.PathEscape(orderID)
	req, err := http.NewRequest("DELETE", fmt.Sprintf("%s/store/orders/%s", c.BasePath, escapedOrderID), nil)
	if err != nil {
		return err
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

func dispatch(req IPCRequest) error {
	client := NewPetStoreGoClient(req.TargetURL)

	pathParams := make(map[string]interface{})
	for k, v := range req.Inputs.PathParams {
		pathParams[k] = irValueToGo(v)
	}

	queryParams := make(map[string]interface{})
	for k, v := range req.Inputs.QueryParams {
		queryParams[k] = irValueToGo(v)
	}

	headerParams := make(map[string]interface{})
	for k, v := range req.Inputs.HeaderParams {
		headerParams[k] = irValueToGo(v)
	}

	var body interface{}
	if req.Inputs.Body != nil {
		body = irValueToGo(*req.Inputs.Body)
	}

	switch req.OperationID {
	case "listPets":
		return client.ListPets(queryParams, headerParams)
	case "createPet":
		return client.CreatePet(body)
	case "getPetById":
		petID := fmt.Sprintf("%v", pathParams["petId"])
		return client.GetPetById(petID, queryParams)
	case "updatePet":
		petID := fmt.Sprintf("%v", pathParams["petId"])
		return client.UpdatePet(petID, body)
	case "deletePet":
		petID := fmt.Sprintf("%v", pathParams["petId"])
		return client.DeletePet(petID)
	case "placeOrder":
		return client.PlaceOrder(body)
	case "getOrderById":
		orderID := fmt.Sprintf("%v", pathParams["orderId"])
		return client.GetOrderById(orderID, headerParams)
	case "deleteOrder":
		orderID := fmt.Sprintf("%v", pathParams["orderId"])
		return client.DeleteOrder(orderID)
	default:
		return fmt.Errorf("unknown operationId: %s", req.OperationID)
	}
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		writeResponse(IPCResponse{Success: false, Error: "no input received on stdin"})
		return
	}

	line := scanner.Bytes()
	var req IPCRequest
	if err := json.Unmarshal(line, &req); err != nil {
		writeResponse(IPCResponse{Success: false, Error: fmt.Sprintf("invalid IPCRequest JSON: %v", err)})
		return
	}

	if err := dispatch(req); err != nil {
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
