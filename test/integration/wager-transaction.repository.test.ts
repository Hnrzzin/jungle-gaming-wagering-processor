
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { randomUUIDv7 } from "bun";

import { createOrm } from "../../src/infrastructure/database/orm";
import { Money } from "../../src/domain/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/wager-transaction";
import { WagerTransactionRepository } from "../../src/infrastructure/database/wager-transaction.repository";
import { Wallet } from "../../src/domain/wallet";
import { WalletRepository } from "../../src/infrastructure/database/wallet.repository";

const brl = (value: string) =>
  Money.from({ amount: value, currency: "BRL" });

let orm: Awaited<ReturnType<typeof createOrm>>;
let em: ReturnType<typeof orm.em.fork>;

beforeAll(async () => {
  orm = await createOrm();
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  em = orm.em.fork();

  await em.execute(
    "truncate wallet_ledger_entries, wagering_transactions, wallets cascade",
  );
});

type CreateTransactionOptions = {
  providerId?: string;
  idempotencyKey?: string;
  externalTransactionId?: string;
  payloadHash?: string;
  amount?: string;
};

async function createTransaction(
  options: CreateTransactionOptions = {},
) {
  const playerId = randomUUIDv7();

  const wallet = Wallet.open({
    id: randomUUIDv7(),
    playerId,
    initialBalance: brl("100.00"),
  });

  await new WalletRepository(em).insert(wallet);

  const transaction = WagerTransaction.create({
    id: randomUUIDv7(),
    providerId: options.providerId ?? "provider-1",
    externalTransactionId:
      options.externalTransactionId ?? "external-123",
    idempotencyKey:
      options.idempotencyKey ?? "idempotency-123",
    payloadHash: options.payloadHash ?? "abc123",
    walletId: wallet.id,
    playerId,
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    money: brl(options.amount ?? "25.00"),
    createdAt: new Date(),
  });

  await new WagerTransactionRepository(em).insert(transaction);

  return { wallet, transaction };
}

describe("WagerTransactionRepository", () => {
  it("encontra uma transação pela chave de idempotência", async () => {
    const { transaction } = await createTransaction();
    const repository = new WagerTransactionRepository(em);

    const found = await repository.findByIdempotencyKey(
      "provider-1",
      "idempotency-123",
    );

    expect(found).not.toBeNull();
    expect(found!.id).toBe(transaction.id);
    expect(found!.providerId).toBe("provider-1");
    expect(found!.idempotencyKey).toBe("idempotency-123");
    expect(found!.payloadHash).toBe("abc123");
    expect(found!.kind).toBe(WagerTransactionKind.Bet);
    expect(found!.status).toBe(WagerTransactionStatus.Pending);
    expect(found!.money.equals(brl("25.00"))).toBe(true);
  });

  it("encontra a mesma transação pelos dois identificadores", async () => {
    const { transaction } = await createTransaction();
    const repository = new WagerTransactionRepository(em);

    const byKey = await repository.findByIdempotencyKey(
      transaction.providerId,
      transaction.idempotencyKey,
    );

    const byExternalId =
      await repository.findByExternalTransactionId(
        transaction.providerId,
        transaction.externalTransactionId,
      );

    expect(byKey?.id).toBe(transaction.id);
    expect(byExternalId?.id).toBe(transaction.id);
  });

  it("permite a mesma chave de idempotência para provedores diferentes", async () => {
    const { transaction } = await createTransaction();

    const { transaction: anotherTransaction } =
      await createTransaction({
        providerId: "provider-2",
        idempotencyKey: transaction.idempotencyKey,
      });

    const repository = new WagerTransactionRepository(em);

    const found = await repository.findByIdempotencyKey(
      "provider-2",
      transaction.idempotencyKey,
    );

    expect(found?.id).toBe(anotherTransaction.id);
    expect(found?.id).not.toBe(transaction.id);
  });

  it("retorna null quando a chave de idempotência não existe", async () => {
    const repository = new WagerTransactionRepository(em);

    const found = await repository.findByIdempotencyKey(
      "provider-1",
      "inexistente",
    );

    expect(found).toBeNull();
  });

  it("encontra uma transação pelo ID externo do provedor", async () => {
    const { transaction } = await createTransaction();
    const repository = new WagerTransactionRepository(em);

    const found = await repository.findByExternalTransactionId(
      "provider-1",
      "external-123",
    );

    expect(found).not.toBeNull();
    expect(found!.id).toBe(transaction.id);
    expect(found!.externalTransactionId).toBe("external-123");
    expect(found!.walletId).toBe(transaction.walletId);
  });

  it("retorna null quando o ID externo não existe", async () => {
    const repository = new WagerTransactionRepository(em);

    const found = await repository.findByExternalTransactionId(
      "provider-1",
      "inexistente",
    );

    expect(found).toBeNull();
  });

  it("não encontra uma transação de outro provedor com a mesma chave", async () => {
    await createTransaction();

    const repository = new WagerTransactionRepository(em);

    const found = await repository.findByIdempotencyKey(
      "outro-provider",
      "idempotency-123",
    );

    expect(found).toBeNull();
  });
});
