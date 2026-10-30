import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new WeakSet<object>());
}

function serialize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("Non-finite numbers are not valid JSON");
    }

    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (typeof value !== "object") {
    throw new CanonicalJsonError(
      `Unsupported JSON value type: ${typeof value}`,
    );
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError("Circular references are not valid JSON");
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return serializeArray(value, ancestors);
    }

    return serializeObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function serializeArray(
  value: unknown[],
  ancestors: WeakSet<object>,
): string {
  const entries: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new CanonicalJsonError("Sparse arrays are not supported");
    }

    entries.push(serialize(value[index], ancestors));
  }

  const extraKeys = Object.keys(value).filter(
    (key) => !isArrayIndex(key, value.length),
  );

  if (extraKeys.length > 0) {
    throw new CanonicalJsonError(
      "Arrays with custom enumerable properties are not supported",
    );
  }

  return `[${entries.join(",")}]`;
}

function serializeObject(
  value: object,
  ancestors: WeakSet<object>,
): string {
  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(
      "Only plain objects are supported in canonical JSON",
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalJsonError(
      "Objects with symbol properties are not supported",
    );
  }

  const keys = Object.keys(value).sort();
  const entries: string[] = [];

  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!descriptor || !("value" in descriptor)) {
      throw new CanonicalJsonError(
        "Objects with accessor properties are not supported",
      );
    }

    entries.push(
      `${JSON.stringify(key)}:${serialize(descriptor.value, ancestors)}`,
    );
  }

  return `{${entries.join(",")}}`;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) {
    return false;
  }

  const index = Number(key);

  return (
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < length &&
    String(index) === key
  );
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}