import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money";
import {
  WagerTransaction,
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from "../../src/domain/wager-transaction";
import { classifyWagerRequest } from "../../src/application/use-cases/classify-wager-request";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00Z");
const PROVIDER = "provider-a";

type Stored = Partial<{
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
}>;

// transação já gravada
const existing = (overrides: Stored = {}) =>
  WagerTransaction.rehydrate({
    id: "t1",
    providerId: PROVIDER,
    externalTransactionId: "ext-1",
    idempotencyKey: "key-1",
    payloadHash: "hash-1",
    walletId: "w1",
    playerId: "p1",
    roundId: "r1",
    gameId: "g1",
    kind: Kind.Bet,
    money: brl("25.00"),
    createdAt: at,
    status: Status.Processed,
    ...overrides,
  });

// requisição recebida do provedor
const request = (overrides: Partial<{
  providerId: string;
  idempotencyKey: string;
  externalTransactionId: string;
  payloadHash: string;
}> = {}) => ({
  providerId: PROVIDER,
  idempotencyKey: "key-1",
  externalTransactionId: "ext-1",
  payloadHash: "hash-1",
  ...overrides,
});

// repositório falso: mesmo contrato das duas buscas do WagerTransactionRepository
const repoWith = (...stored: WagerTransaction[]) => ({
  async findByIdempotencyKey(providerId: string, key: string) {
    return stored.find((t) => t.providerId === providerId && t.idempotencyKey === key) ?? null;
  },
  async findByExternalTransactionId(providerId: string, ext: string) {
    return stored.find((t) => t.providerId === providerId && t.externalTransactionId === ext) ?? null;
  },
});

describe("classifyWagerRequest", () => {
  test("nenhum identificador encontrado → NEW", async () => {
    const result = await classifyWagerRequest(repoWith(), request());
    expect(result.outcome).toBe("NEW");
  });

  test("mesma chave e mesmo ID externo, mesmo registro e payload igual → DUPLICATE", async () => {
    const result = await classifyWagerRequest(repoWith(existing()), request());
    expect(result.outcome).toBe("DUPLICATE");
    expect(result.transaction?.id).toBe("t1");
  });

  test("mesmo registro, payload diferente → CONFLICT", async () => {
    const result = await classifyWagerRequest(
      repoWith(existing()),
      request({ payloadHash: "outro-hash" }),
    );
    expect(result.outcome).toBe("CONFLICT");
  });

  test("só a chave existe, payload igual, ID externo divergente → CONFLICT", async () => {
    // byKey = t1, byExternal = null
    const result = await classifyWagerRequest(
      repoWith(existing()),
      request({ externalTransactionId: "ext-2" }),
    );
    expect(result.outcome).toBe("CONFLICT");
  });

  test("só o ID externo existe, payload igual, chave divergente → CONFLICT", async () => {
    // byKey = null, byExternal = t1
    const result = await classifyWagerRequest(
      repoWith(existing()),
      request({ idempotencyKey: "key-2" }),
    );
    expect(result.outcome).toBe("CONFLICT");
  });

  test("identificadores apontam para registros diferentes → CONFLICT", async () => {
    // chave → t1, ID externo → t2
    const result = await classifyWagerRequest(
      repoWith(
        existing({ id: "t1", idempotencyKey: "key-1", externalTransactionId: "ext-1" }),
        existing({ id: "t2", idempotencyKey: "key-2", externalTransactionId: "ext-2" }),
      ),
      request({ idempotencyKey: "key-1", externalTransactionId: "ext-2" }),
    );
    expect(result.outcome).toBe("CONFLICT");
  });

  test("registro de outro provedor não conta → NEW", async () => {
    const result = await classifyWagerRequest(
      repoWith(existing({ providerId: "provider-b" })),
      request(),
    );
    expect(result.outcome).toBe("NEW");
  });
});