export const APP_NAME = "wireparity";

export function getVersion(): string {
  return "0.1.0";
}

export * from "./capture/types.js";
export * from "./capture/server.js";
