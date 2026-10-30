import { describe, expect, it } from "bun:test";
import {
  InvalidWagerBetRequestError,
  parseWagerBetRequest,
} from "../../src/application/services/wager-bet-request";

const validBody = {
  providerId: "provider-1",
  playerId: "player-1",
  walletId: "wallet-1",
  externalTransactionId: "external-1",
  amount: "80.00",
  currency: "BRL",
};

describe("parseWagerBetRequest", () => {
  it("maps a valid HTTP payload to a ProcessWager command", () => {
    expect(
      parseWagerBetRequest(validBody, "request-1"),
    ).toEqual({
      providerId: "provider-1",
      playerId: "player-1",
      walletId: "wallet-1",
      externalTransactionId: "external-1",
      idempotencyKey: "request-1",
      amount: "80.00",
      currency: "BRL",
    });
  });

  it("requires the idempotency key", () => {
    expect(() =>
      parseWagerBetRequest(validBody, undefined),
    ).toThrow(InvalidWagerBetRequestError);
  });

  it("rejects an empty idempotency key", () => {
    expect(() =>
      parseWagerBetRequest(validBody, " "),
    ).toThrow("Idempotency-Key header cannot be empty");
  });

  it("rejects an oversized idempotency key", () => {
    expect(() =>
      parseWagerBetRequest(validBody, "x".repeat(256)),
    ).toThrow("Idempotency-Key header exceeds 255 characters");
  });

  it("requires a provider ID", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, providerId: "" },
        "request-1",
      ),
    ).toThrow("providerId is required");
  });

  it("requires a player ID", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, playerId: "" },
        "request-1",
      ),
    ).toThrow("playerId is required");
  });

  it("requires a wallet ID", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, walletId: "" },
        "request-1",
      ),
    ).toThrow("walletId is required");
  });

  it("requires an external transaction ID", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, externalTransactionId: "" },
        "request-1",
      ),
    ).toThrow("externalTransactionId is required");
  });

  it("requires an amount", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, amount: "" },
        "request-1",
      ),
    ).toThrow("amount is required");
  });

  it("requires an ISO currency code", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, currency: "brl" },
        "request-1",
      ),
    ).toThrow("currency must be an ISO 4217 uppercase code");
  });

  it("rejects amounts without exactly two decimal places", () => {
    const invalidAmounts = [
      "80",
      "80.0",
      "80.000",
      "80,00",
      "-80.00",
      "1e2",
      "NaN",
      "Infinity",
    ];

    for (const amount of invalidAmounts) {
      expect(() =>
        parseWagerBetRequest(
          { ...validBody, amount },
          "request-1",
        ),
      ).toThrow(InvalidWagerBetRequestError);
    }
  });

  it("rejects numeric amount values", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, amount: 80 },
        "request-1",
      ),
    ).toThrow("amount is required");
  });

  it("rejects non-object payload fields", () => {
    expect(() =>
      parseWagerBetRequest(
        { ...validBody, playerId: 123 },
        "request-1",
      ),
    ).toThrow("playerId is required");
  });

  it("preserves the supplied idempotency key", () => {
    const key = " request-1 ";

    expect(
      parseWagerBetRequest(validBody, key).idempotencyKey,
    ).toBe(key);
  });
});