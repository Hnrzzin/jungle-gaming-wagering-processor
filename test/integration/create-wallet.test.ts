
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { createOrm } from "../../src/infrastructure/database/orm";
import { Money } from "../../src/domain/money";
import { CreateWallet } from "../../src/application/use-cases/create-wallet";
import { WalletRepository } from "../../src/infrastructure/database/wallet.repository";
import { LedgerRepository } from "../../src/infrastructure/database/ledger.repository";
import type { LedgerDirection } from "../../src/domain/wallet-ledger-entry";

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

describe("CreateWallet", () => {
  it("cria uma carteira com saldo zero sem gerar OPENING ou lançamento", async () => {
    const playerId = crypto.randomUUID();

    const useCase = new CreateWallet(em);

    const wallet = await useCase.execute({
      playerId,
      initialBalance: brl("0.00"),
    });

    const persistedWallet = await new WalletRepository(em).findById(wallet.id);

    const transactions = await em.execute(
      "select * from wagering_transactions where wallet_id = ?",
      [wallet.id],
    );

    const entries = await new LedgerRepository(em).findByWalletId(wallet.id);

    expect(persistedWallet).not.toBeNull();
    expect(persistedWallet!.balance.equals(brl("0.00"))).toBe(true);
    expect(transactions).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  
  it("reverte carteira e transação OPENING quando o lançamento no ledger falha", async () => {
    const playerId = crypto.randomUUID();

    // Cria um gatilho que falha somente para esta carteira.
    // Assim, não interfere nos demais testes.
    await em.execute(`
      CREATE OR REPLACE FUNCTION test_reject_create_wallet_ledger()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM wallets
          WHERE id = NEW.wallet_id
          AND player_id = '${playerId}'
        ) THEN
          RAISE EXCEPTION 'forced ledger failure';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await em.execute(`
      CREATE TRIGGER test_reject_create_wallet_ledger
      BEFORE INSERT ON wallet_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION test_reject_create_wallet_ledger();
    `);

    try {
      const useCase = new CreateWallet(em);

      await expect(
        useCase.execute({
          playerId,
          initialBalance: brl("100.00"),
        }),
      ).rejects.toThrow("forced ledger failure");

      const wallets = await em.execute(
        "SELECT COUNT(*)::int AS count FROM wallets WHERE player_id = ?",
        [playerId],
      );

      const transactions = await em.execute(
        "SELECT COUNT(*)::int AS count FROM wagering_transactions WHERE player_id = ?",
        [playerId],
      );

      const entries = await em.execute(
        `SELECT COUNT(*)::int AS count
         FROM wallet_ledger_entries ledger
         INNER JOIN wallets wallet ON wallet.id = ledger.wallet_id
         WHERE wallet.player_id = ?`,
        [playerId],
      );

      expect(Number(wallets[0]!.count)).toBe(0);
      expect(Number(transactions[0]!.count)).toBe(0);
      expect(Number(entries[0]!.count)).toBe(0);
    } finally {
      await em.execute(
        "DROP TRIGGER IF EXISTS test_reject_create_wallet_ledger ON wallet_ledger_entries",
      );

      await em.execute(
        "DROP FUNCTION IF EXISTS test_reject_create_wallet_ledger()",
      );
    }
  });


  it("cria uma carteira com saldo positivo e registra OPENING e crédito no ledger", async () => {
    const playerId = crypto.randomUUID();

    const useCase = new CreateWallet(em);

    const wallet = await useCase.execute({
      playerId,
      initialBalance: brl("100.00"),
    });

    const persistedWallet = await new WalletRepository(em).findById(wallet.id);

    const transactions = await em.execute(
      `select kind, status, amount, currency, processed_at
       from wagering_transactions
       where wallet_id = ?`,
      [wallet.id],
    );

    const entries = await new LedgerRepository(em).findByWalletId(wallet.id);

    expect(persistedWallet).not.toBeNull();
    expect(persistedWallet!.balance.equals(brl("100.00"))).toBe(true);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.kind).toBe("OPENING");
    expect(transactions[0]!.status).toBe("PROCESSED");
    expect(transactions[0]!.amount.toString()).toBe("100.00");
    expect(transactions[0]!.currency).toBe("BRL");
    expect(transactions[0]!.processed_at).not.toBeNull();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe('CREDIT' as LedgerDirection);
    expect(entries[0]!.money.equals(brl("100.00"))).toBe(true);
    expect(entries[0]!.balanceBefore.equals(brl("0.00"))).toBe(true);
    expect(entries[0]!.balanceAfter.equals(brl("100.00"))).toBe(true);
  });
});
