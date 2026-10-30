import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUIDv7 } from "bun";
import { createOrm } from "../../src/infrastructure/database/orm";
import { Money } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { FailureCode } from "../../src/domain/failure-code";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/wager-transaction";
import { WalletRepository } from "../../src/infrastructure/database/wallet.repository";
import { WagerTransactionRepository } from "../../src/infrastructure/database/wager-transaction.repository";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

let orm: Awaited<ReturnType<typeof createOrm>>;

beforeAll(async () => { orm = await createOrm(); });
afterAll(async () => { await orm.close(); });
beforeEach(async () => {
  await orm.em.getConnection().execute(
    "truncate wallet_ledger_entries, wagering_transactions, wallets cascade",
  );
});

describe("WagerTransactionRepository: failure_code", () => {
  it("grava e relê o motivo da rejeição", async () => {
    const em = orm.em.fork();
    const wallet = Wallet.open({ id: randomUUIDv7(), playerId: randomUUIDv7(), initialBalance: brl("0.00") });
    await new WalletRepository(em).insert(wallet);

    const rejected = WagerTransaction.rehydrate({
      id: randomUUIDv7(),
      providerId: "provider-a",
      externalTransactionId: "ext-1",
      idempotencyKey: "key-1",
      payloadHash: "hash-1",
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: brl("80.00"),
      createdAt: new Date(),
      status: WagerTransactionStatus.Rejected,
      failureCode: FailureCode.InsufficientBalance,
    });

    const repo = new WagerTransactionRepository(em);
    await repo.insert(rejected);

    const found = await new WagerTransactionRepository(orm.em.fork()).findByIdempotencyKey("provider-a", "key-1");

    expect(found).not.toBeNull();
    expect(found!.status).toBe(WagerTransactionStatus.Rejected);
    expect(found!.failureCode).toBe(FailureCode.InsufficientBalance);
  });
});