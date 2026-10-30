import { describe, expect, it } from "bun:test";
import {
  InvalidIdempotencyKeyError,
  validateIdempotencyKey,
} from "../../src/application/services/validate-idempotency-key";

describe("validateIdempotencyKey", () => {
  it("accepts a valid key", () => {
    expect(validateIdempotencyKey("request-123")).toBe("request-123");
  });

  it("preserves the original key", () => {
    const key = " request-123 ";

    expect(validateIdempotencyKey(key)).toBe(key);
  });

  it("rejects undefined", () => {
    expect(() => validateIdempotencyKey(undefined)).toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it("rejects an empty string", () => {
    expect(() => validateIdempotencyKey("")).toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it("rejects a whitespace-only string", () => {
    expect(() => validateIdempotencyKey("   ")).toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it("rejects keys longer than 255 characters", () => {
    expect(() => validateIdempotencyKey("a".repeat(256))).toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it("accepts keys with exactly 255 characters", () => {
    const key = "a".repeat(255);

    expect(validateIdempotencyKey(key)).toBe(key);
  });
});