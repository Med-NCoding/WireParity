export const APP_NAME = "wireparity";
export function getVersion(): string {
  return "0.1.0";
}

export * from "./capture/types.js";
export * from "./capture/server.js";
export * from "./ir/index.js";
export * from "./openapi/index.js";
export * from "./normalization/index.js";
export * from "./comparator/index.js";
export * from "./runners/index.js";
export * from "./generator/index.js";
export * from "./shrinker/index.js";
export * from "./reporter/index.js";
export * from "./cli/index.js";
export * from "./telemetry/index.js";


