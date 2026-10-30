import { describe, expect, it } from "bun:test";
import { createWagerPayloadHash } from "../../src/application/services/wager-payload-hash";

const payload = {
  providerId: "provider-1",
  playerId: "player-1",
  walletId: "wallet-1",
  externalTransactionId: "external-1",
  type: "BET" as const,
  amount: "80.00",
  currency: "BRL",
};

describe("createWagerPayloadHash", () => {
  it("returns a SHA-256 hexadecimal digest", () => {
    const result = createWagerPayloadHash(payload);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the same hash for equivalent payloads", () => {
    const first = createWagerPayloadHash(payload);

    const second = createWagerPayloadHash({
      currency: "BRL",
      amount: "80.00",
      type: "BET",
      externalTransactionId: "external-1",
      walletId: "wallet-1",
      playerId: "player-1",
      providerId: "provider-1",
    });

    expect(first).toBe(second);
  });

  it("changes the hash when the amount changes", () => {
    expect(createWagerPayloadHash(payload)).not.toBe(
      createWagerPayloadHash({
        ...payload,
        amount: "80.01",
      }),
    );
  });

  it("changes the hash when the player changes", () => {
    expect(createWagerPayloadHash(payload)).not.toBe(
      createWagerPayloadHash({
        ...payload,
        playerId: "player-2",
      }),
    );
  });

  it("changes the hash when the wallet changes", () => {
    expect(createWagerPayloadHash(payload)).not.toBe(
      createWagerPayloadHash({
        ...payload,
        walletId: "wallet-2",
      }),
    );
  });

  it("changes the hash when the external transaction ID changes", () => {
    expect(createWagerPayloadHash(payload)).not.toBe(
      createWagerPayloadHash({
        ...payload,
        externalTransactionId: "external-2",
      }),
    );
  });

  it("changes the hash when the provider changes", () => {
    expect(createWagerPayloadHash(payload)).not.toBe(
      createWagerPayloadHash({
        ...payload,
        providerId: "provider-2",
      }),
    );
  });
});