# WireParity Architecture Flow

```
OpenAPI Spec
     │
     ▼
Internal API Call Representation
     │
     ▼
SDK Runners
     │
     ▼
HTTP Capture Server
     │
     ▼
Request Normalization
     │
     ▼
Semantic Comparison
     │
     ▼
Property-Based Generation
     │
     ▼
Shrinking & Reporting
```

---

### 1. OpenAPI Spec
The source of truth definition describing available endpoints, schemas, parameters, and authentication methods. It provides the contract that all generated SDKs are supposed to follow.

### 2. Internal API Call Representation
A neutral, language-agnostic data structure that represents a single logical API operation and its input values. It bridges the OpenAPI specification with the test execution pipeline.

### 3. SDK Runners
Language-specific worker scripts that instantiate the target SDKs and execute API calls using the test inputs. They translate the neutral representation into native language method invocations.

### 4. HTTP Capture Server
A local HTTP sink that intercepts and records all outgoing requests emitted by the SDK runners. It captures raw methods, URLs, headers, query parameters, and request bodies.

### 5. Request Normalization
A transformation step that converts raw HTTP request components into canonical semantic structures. It strips away harmless formatting differences like header casing and key ordering.

### 6. Semantic Comparison
The diff engine that evaluates normalized requests from multiple SDKs against each other. It flags meaningful behavioral discrepancies such as missing fields, differing date formats, or conflicting query encodings.

### 7. Property-Based Generation
An automated input generator that produces a large variety of randomized values and boundary edge-cases from schema rules. It repeatedly feeds the pipeline to expose hidden serialization discrepancies across SDKs.

### 8. Shrinking & Reporting
A reducer that simplifies failing test inputs down to the minimal reproducible example that triggers the divergence. It outputs clean, human-readable diff reports showing where SDK behaviors split.
