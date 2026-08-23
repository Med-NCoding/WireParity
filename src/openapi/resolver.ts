import { isRef, type OpenAPISpecRaw, type RefRaw } from "./types.js";

/**
 * Structured error thrown when a $ref cannot be resolved.
 * Contains the `ref` string that triggered the failure.
 */
export class ResolverError extends Error {
  constructor(
    message: string,
    public readonly ref: string
  ) {
    super(message);
    this.name = "ResolverError";
  }
}

/**
 * Resolves local JSON Pointer $refs (e.g. `#/components/schemas/User`) against
 * an OpenAPI root document.
 *
 * Supports:
 * - Single-hop resolution: `{ $ref: "#/components/schemas/Foo" }`
 * - Chained resolution: a $ref that itself points to another $ref
 * - Deep JSON Pointer paths with RFC 6901 escape sequences (~0 → ~, ~1 → /)
 * - Circular reference detection across the full resolution chain
 */
export class OpenAPIRefResolver {
  constructor(private readonly doc: OpenAPISpecRaw) {}

  /**
   * Resolves a target that may be a RefRaw or an already-concrete object.
   * Follows chains of $refs until a concrete value is reached.
   * Throws ResolverError if the ref cannot be found, is external, or is circular.
   */
  resolve<T>(target: T | RefRaw): T {
    return this._resolve<T>(target, new Set<string>());
  }

  /**
   * Convenience helper: resolves every element of a mixed array of refs or concrete objects.
   */
  resolveAll<T>(targets: Array<T | RefRaw>): T[] {
    return targets.map((t) => this.resolve<T>(t));
  }

  // Internal recursive resolver that threads a visited chain through recursion.
  private _resolve<T>(target: T | RefRaw, chain: Set<string>): T {
    if (!isRef(target)) {
      return target;
    }

    const ref = target.$ref;

    // Only local JSON Pointer refs are supported.
    if (!ref.startsWith("#/") && ref !== "#") {
      throw new ResolverError(
        `External $ref is not supported: "${ref}". Only local JSON Pointer refs (#/...) are accepted.`,
        ref
      );
    }

    // Circular reference: if this ref is already in our current traversal chain,
    // following it again would loop forever.
    if (chain.has(ref)) {
      throw new ResolverError(
        `Circular $ref detected: "${ref}" references itself through the chain [${[...chain].join(" → ")} → ${ref}]`,
        ref
      );
    }

    const resolved = this.lookupPointer(ref);

    // If the resolved value is itself a $ref, follow the chain recursively.
    if (isRef(resolved)) {
      const nextChain = new Set(chain);
      nextChain.add(ref);
      return this._resolve<T>(resolved as RefRaw, nextChain);
    }

    return resolved as T;
  }

  /**
   * Walks the document using a JSON Pointer string (RFC 6901).
   * Decodes ~1 → / and ~0 → ~ in each path segment.
   * Throws ResolverError if any segment is not found or the path reaches a primitive.
   */
  private lookupPointer(pointer: string): unknown {
    // "#" alone refers to the root document
    if (pointer === "#") {
      return this.doc;
    }

    // Strip leading "#/" and split on "/"
    const parts = pointer.slice(2).split("/");
    let current: unknown = this.doc;

    for (const rawPart of parts) {
      if (current === null || typeof current !== "object") {
        throw new ResolverError(
          `Cannot resolve "${pointer}": reached a non-object value at segment "${rawPart}"`,
          pointer
        );
      }

      // RFC 6901 JSON Pointer escape sequences: ~1 → /  and  ~0 → ~
      // Order matters: decode ~1 before ~0 to avoid double-decoding.
      const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");

      const record = current as Record<string, unknown>;
      if (!(part in record)) {
        throw new ResolverError(
          `Cannot resolve "${pointer}": segment "${part}" not found in object`,
          pointer
        );
      }

      current = record[part];
    }

    return current;
  }
}
