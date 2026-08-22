import { isRef, type OpenAPISpecRaw, type RefRaw } from "./types.js";

/**
 * Resolves local JSON pointers (e.g. `#/components/schemas/User`) against an OpenAPI root document.
 */
export class OpenAPIRefResolver {
  private visited = new Set<string>();

  constructor(private readonly doc: OpenAPISpecRaw) {}

  /**
   * Resolves a target which may be a Ref or an actual object.
   * Prevents infinite loops caused by circular schema references.
   */
  resolve<T>(target: T | RefRaw): T {
    if (!isRef(target)) {
      return target;
    }

    const ref = target.$ref;
    if (!ref.startsWith("#/")) {
      throw new Error(`External $ref is currently not supported: ${ref}`);
    }

    const resolved = this.lookupPointer(ref);
    if (isRef(resolved)) {
      if (this.visited.has(ref)) {
        throw new Error(`Circular reference detected while resolving: ${ref}`);
      }
      this.visited.add(ref);
      try {
        return this.resolve<T>(resolved as T | RefRaw);
      } finally {
        this.visited.delete(ref);
      }
    }

    return resolved as T;
  }

  private lookupPointer(pointer: string): unknown {
    const parts = pointer.slice(2).split("/");
    let current: unknown = this.doc;

    for (const rawPart of parts) {
      if (current === null || typeof current !== "object") {
        throw new Error(`Cannot resolve pointer ${pointer}: reached non-object at segment '${rawPart}'`);
      }

      // JSON pointer decoding: ~1 -> / and ~0 -> ~
      const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");

      if (!(part in (current as Record<string, unknown>))) {
        throw new Error(`Cannot resolve pointer ${pointer}: segment '${part}' not found`);
      }

      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
