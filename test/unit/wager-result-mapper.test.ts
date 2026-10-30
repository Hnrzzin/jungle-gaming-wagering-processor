import { describe, expect, it } from "bun:test";
import {
  mapWagerResult,
} from "../../src/application/services/wager-result-mapper";
import type {
  WagerRecord,
} from "../../src/application/use-cases/process-wager";

const transaction: WagerRecord = {
  id: "wager-1",
  providerId: "provider-1",
  playerId: "player-1",
  walletId: "wallet-1",
  externalTransactionId: "external-1",
  idempotencyKey: "key-1",
  payloadHash: "a".repeat(64),
  type: "BET",
  status: "PROCESSED",
  amount: {
    amount: "80.00",
    currency: "BRL",
  },
  failureCode: null,
};

describe("mapWagerResult", () => {
  it("maps a processed wager", () => {
    expect(
      mapWagerResult({
        outcome: "PROCESSED",
        transaction,
        replayed: false,
      }),
    ).toEqual({
      outcome: "PROCESSED",
      replayed: false,
      transaction: {
        id: "wager-1",
        providerId: "provider-1",
        playerId: "player-1",
        walletId: "wallet-1",
        externalTransactionId: "external-1",
        type: "BET",
        status: "PROCESSED",
        amount: "80.00",
        currency: "BRL",
        failureCode: null,
      },
    });
  });

  it("maps a duplicate replay", () => {
    const result = mapWagerResult({
      outcome: "DUPLICATE",
      transaction,
      replayed: true,
    });

    expect(result.outcome).toBe("DUPLICATE");
    expect(result.replayed).toBe(true);
    expect(result.transaction.id).toBe("wager-1");
  });

  it("maps an insufficient-funds rejection", () => {
    const rejected: WagerRecord = {
      ...transaction,
      status: "REJECTED",
      failureCode: "INSUFFICIENT_FUNDS",
    };

    const result = mapWagerResult({
      outcome: "REJECTED",
      transaction: rejected,
      replayed: false,
    });

    expect(result.outcome).toBe("REJECTED");
    expect(result.transaction.failureCode).toBe(
      "INSUFFICIENT_FUNDS",
    );
  });

  it("maps an idempotency conflict", () => {
    const result = mapWagerResult({
      outcome: "CONFLICT",
      transaction,
      replayed: false,
    });

    expect(result.outcome).toBe("CONFLICT");
    expect(result.replayed).toBe(false);
  });
});