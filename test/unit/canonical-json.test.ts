import { describe, expect, it } from "bun:test";
import {
  CanonicalJsonError,
  canonicalJson,
  sha256CanonicalJson,
} from "../../src/application/services/canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    const result = canonicalJson({
      z: 1,
      a: {
        y: 2,
        b: 3,
      },
    });

    expect(result).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes primitive values", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson("value")).toBe('"value"');
    expect(canonicalJson(10)).toBe("10");
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  it("generates the same representation regardless of object key order", () => {
    const first = {
      playerId: "player-1",
      amount: "80.00",
      currency: "BRL",
    };

    const second = {
      currency: "BRL",
      amount: "80.00",
      playerId: "player-1",
    };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(sha256CanonicalJson(first)).toBe(
      sha256CanonicalJson(second),
    );
  });

  it("generates different hashes when a business value changes", () => {
    const first = {
      playerId: "player-1",
      amount: "80.00",
      currency: "BRL",
    };

    const second = {
      playerId: "player-1",
      amount: "80.01",
      currency: "BRL",
    };

    expect(sha256CanonicalJson(first)).not.toBe(
      sha256CanonicalJson(second),
    );
  });

  it("rejects undefined", () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
  });

  it("rejects functions", () => {
    expect(() => canonicalJson(() => undefined)).toThrow(
      CanonicalJsonError,
    );
  });

  it("rejects bigint", () => {
    expect(() => canonicalJson(1n)).toThrow(CanonicalJsonError);
  });

  it("rejects symbols", () => {
    expect(() => canonicalJson(Symbol("value"))).toThrow(
      CanonicalJsonError,
    );
  });

  it("rejects NaN", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(CanonicalJsonError);
  });

  it("rejects positive infinity", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      CanonicalJsonError,
    );
  });

  it("rejects negative infinity", () => {
    expect(() => canonicalJson(Number.NEGATIVE_INFINITY)).toThrow(
      CanonicalJsonError,
    );
  });

  it("rejects circular references", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects Date instances", () => {
    expect(() => canonicalJson(new Date())).toThrow(CanonicalJsonError);
  });

  it("rejects Map instances", () => {
    expect(() => canonicalJson(new Map())).toThrow(CanonicalJsonError);
  });

  it("rejects sparse arrays", () => {
    const value = new Array(2);
    value[1] = "value";

    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects arrays with custom enumerable properties", () => {
    const value: unknown[] & { extra?: string } = [1, 2];
    value.extra = "value";

    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects accessor properties", () => {
    const value = Object.defineProperty({}, "amount", {
      enumerable: true,
      get: () => "80.00",
    });

    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects symbol properties", () => {
    const value = {
      amount: "80.00",
      [Symbol("secret")]: "value",
    };

    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("accepts objects with a null prototype", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.amount = "80.00";

    expect(canonicalJson(value)).toBe('{"amount":"80.00"}');
  });
});