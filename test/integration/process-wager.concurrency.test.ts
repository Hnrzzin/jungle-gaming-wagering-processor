import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUIDv7 } from "bun";
import { createOrm } from "../../src/infrastructure/database/orm";
import { Money } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { LedgerDirection } from "../../src/domain/wallet-ledger-entry";
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus as Status } from "../../src/domain/wager-transaction";
import { WalletRepository } from "../../src/infrastructure/database/wallet.repository";
import { LedgerRepository } from "../../src/infrastructure/database/ledger.repository";
import { ProcessWager } from "../../src/application/use-cases/process-wager"; //substiutir por process-wager

const brl = (value: string) => Money.from({ amount: value, currency: "BRL" });

let orm: Awaited<ReturnType<typeof createOrm>>;
const run = (sql: string, params: unknown[] = []) => orm.em.getConnection().execute(sql, params);

beforeAll(async () => { orm = await createOrm(); });
afterAll(async () => { await orm.close(); });
beforeEach(async () => {
  await run("truncate wallet_ledger_entries, wagering_transactions, wallets cascade");
});

// Carteira com saldo inicial, pelo mesmo caminho do OPENING (wallet + transação + CREDIT)
async function seedWallet(initial: string) {
  const wallet = Wallet.open({ id: randomUUIDv7(), playerId: randomUUIDv7(), initialBalance: brl("0.00") });
  const txId = randomUUIDv7();
  const entry = wallet.credit({ entryId: randomUUIDv7(), transactionId: txId, money: brl(initial), at: new Date() });
  const em = orm.em.fork();
  await new WalletRepository(em).insert(wallet);
  await em.execute(
    `insert into wagering_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, status, amount, currency, created_at)
     values (?, 'system', ?, ?, 'opening', ?, ?, 'opening', 'opening', 'OPENING', 'PROCESSED', ?, 'BRL', now())`,
    [txId, wallet.id, `system:${wallet.id}`, wallet.id, wallet.playerId, initial],
  );
  await new LedgerRepository(em).append(entry);
  return wallet;
}

const bet = (walletId: string, playerId: string, n: number) => ({
  providerId: "provider-a",
  idempotencyKey: `key-${n}`,
  externalTransactionId: `ext-${n}`,
  payloadHash: `hash-${n}`,
  walletId,
  playerId,
  roundId: `round-${n}`,
  gameId: "game-1",
  kind: WagerTransactionKind.Bet,
  money: brl("80.00"),
  at: new Date(),
});

describe("ProcessWager: BET concorrente", () => {
  it("duas apostas de 80 simultâneas com saldo 100: uma PROCESSED, uma REJECTED, saldo 20, um débito", async () => {
    const wallet = await seedWallet("100.00");
    const useCase = (n: number) => new ProcessWager(orm.em.fork()).execute(bet(wallet.id, wallet.playerId, n));

    const results = await Promise.allSettled([useCase(1), useCase(2)]);

    // rejeição por saldo é resultado de negócio: as duas promessas devem resolver
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const statuses = results.map((r) => (r as PromiseFulfilledResult<WagerTransaction>).value.status).sort();
    expect(statuses).toEqual([Status.Processed, Status.Rejected].sort());

    const rows = await run("select balance from wallets where id = ?", [wallet.id]);
    expect(String(rows[0]?.balance)).toBe("20.00");
    expect(String(rows)).toBe("20.00");

    const debits = await run(
      "select id from wallet_ledger_entries where wallet_id = ? and direction = ?",
      [wallet.id, LedgerDirection.Debit],
    );
    expect(debits).toHaveLength(1);
  });
});