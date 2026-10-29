import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUIDv7 } from "bun";
import { createOrm } from "../../src/infrastructure/database/orm";
import { Money, type MoneyProps } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { LedgerDirection } from "../../src/domain/wallet-ledger-entry";
import { WalletRepository } from "../../src/infrastructure/database/wallet.repository";
import { LedgerRepository } from "../../src/infrastructure/database/ledger.repository";

// ÚNICO ponto que depende de como o Money é criado.
// Se a assinatura de Money.from for diferente, ajuste só esta linha.
const brl = (value: string) => Money.from({amount: value, currency: "BRL"});

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
  await em.execute("truncate wallet_ledger_entries, wagering_transactions, wallets cascade");
});

// Carteira aberta com saldo zero + crédito inicial (o desenho do OPENING)
function openedWallet(transactionId: string) {
  const wallet = Wallet.open({
    id: randomUUIDv7(),
    playerId: randomUUIDv7(),
    initialBalance: brl("0.00"),
  });
  const entry = wallet.credit({
    entryId: randomUUIDv7(),
    transactionId,
    money: brl("100.00"),
    at: new Date(),
  });
  return { wallet, entry };
}

const insertOpeningTransaction = (txId: string, wallet: Wallet) =>
  em.execute(
    `insert into wagering_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, status, amount, currency, created_at)
     values (?, 'system', ?, ?, 'opening', ?, ?, 'opening', 'opening', 'OPENING', 'PROCESSED', 100.00, 'BRL', now())`,
    [txId, wallet.id, `system:${wallet.id}`, wallet.id, wallet.playerId],
  );

describe("WalletRepository", () => {
  it("grava e relê uma carteira com o mesmo estado", async () => {
    const { wallet } = openedWallet(randomUUIDv7());
    const repo = new WalletRepository(em);

    await repo.insert(wallet);
    const found = await repo.findById(wallet.id);

    expect(found).not.toBeNull();
    expect(found!.playerId).toBe(wallet.playerId);
    expect(found!.currency).toBe("BRL");
    expect(found!.balance.equals(wallet.balance)).toBe(true);
    expect(found!.version).toBe(wallet.version);
  });

  it("devolve null quando a carteira não existe", async () => {
    expect(await new WalletRepository(em).findById(randomUUIDv7())).toBeNull();
  });
});

describe("LedgerRepository", () => {
  it("grava um lançamento e relê com os mesmos valores", async () => {
    const txId = randomUUIDv7();
    const { wallet, entry } = openedWallet(txId);

    await new WalletRepository(em).insert(wallet);
    await insertOpeningTransaction(txId, wallet);
    const ledger = new LedgerRepository(em);
    await ledger.append(entry);

    const entries = await ledger.findByWalletId(wallet.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.direction).toBe(LedgerDirection.Credit);
    expect(entries[0]!.money.equals(brl("100.00"))).toBe(true);
    expect(entries[0]!.balanceBefore.equals(brl("0.00"))).toBe(true);
    expect(entries[0]!.balanceAfter.equals(brl("100.00"))).toBe(true);
  });
});

describe("atomicidade: carteira + lançamento na mesma transação", () => {
  it("se o lançamento falhar, a carteira também não é gravada", async () => {
    // transactionId que NÃO existe em wagering_transactions -> a FK do ledger falha
    const { wallet, entry } = openedWallet(randomUUIDv7());

    await expect(
      orm.em.transactional(async (tx) => {
        await new WalletRepository(tx).insert(wallet);
        await new LedgerRepository(tx).append(entry);
      }),
    ).rejects.toThrow("wallet_ledger_entries_transaction_fk");

    // fora da transação, a carteira não pode ter sobrado
    expect(await new WalletRepository(em).findById(wallet.id)).toBeNull();
  });
});