import { describe, expect, it } from "bun:test";
import { UuidIdGenerator } from "../../src/application/services/uuid-id-generator";

describe("UuidIdGenerator", () => {
  it("generates UUIDs", () => {
    const generator = new UuidIdGenerator();

    expect(generator.generate()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("generates unique identifiers", () => {
    const generator = new UuidIdGenerator();
    const identifiers = new Set(
      Array.from({ length: 1000 }, () => generator.generate()),
    );

    expect(identifiers.size).toBe(1000);
  });
});