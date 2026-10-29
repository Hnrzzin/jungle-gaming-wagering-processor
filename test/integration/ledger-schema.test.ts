import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUIDv7 } from "bun";
import { createOrm } from "../../src/infrastructure/database/orm";

// Ids fixos por teste para evitar erro de digitação
const WALLET_ID = randomUUIDv7();
const PLAYER_ID = randomUUIDv7();
const TX_ID = randomUUIDv7();
const TX2_ID = randomUUIDv7();
const ENTRY_ID = randomUUIDv7();

let orm: Awaited<ReturnType<typeof createOrm>>;


const run = (query: string, params: unknown[] = []) =>
  orm.em.getConnection().execute(query, params);

beforeAll(async () => {
  orm = await createOrm();
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  
  await run("truncate wallet_ledger_entries, wagering_transactions, wallets cascade");
  await run(
    "insert into wallets (id, player_id, currency, balance, version) values (?, ?, 'BRL', 100.00, 1)", // cadastra uma entrada na carteira de um usuario
    [WALLET_ID, PLAYER_ID],
  );
  await run( // cadastra o as informações do tipo de ação de um usuario 
    `insert into wagering_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, status, amount, currency, created_at)
     values (?, 'provider-a', 'tx-1', 'provider-a:tx-1', 'hash-1',
        ?, ?, 'round-1', 'game-1', 'BET', 'PROCESSED', 25.00, 'BRL', now())`,
    [TX_ID, WALLET_ID, PLAYER_ID],
  );
});

const insertEntry = (overrides: { // cadastra uma ação na wallet (historico - só adiciona, não atualiza nem deleta)
  id?: string;
  transactionId?: string;
  direction?: string;
  amount?: string;
  before?: string;
  after?: string;
} = {}) =>
  run(
    `insert into wallet_ledger_entries
       (id, wallet_id, transaction_id, direction, amount, balance_before, balance_after, created_at)
     values (?, ?, ?, ?, ?, ?, ?, now())`,
    [
      overrides.id ?? ENTRY_ID,
      WALLET_ID,
      overrides.transactionId ?? TX_ID,
      overrides.direction ?? "DEBIT",
      overrides.amount ?? "25.00",
      overrides.before ?? "100.00",
      overrides.after ?? "75.00",
    ],
  );

describe("schema do ledger: wallet_ledger_entries", () => {
  it("aceita um débito balanceado", async () => {
    await insertEntry();
    const rows = await run("select amount from wallet_ledger_entries where id = ?", [ENTRY_ID]);
    expect(rows).toHaveLength(1);
  });

  it("rejeita direção fora de DEBIT/CREDIT pela constraint wallet_ledger_entries_direction_check", async () => {
    await expect(insertEntry({ direction: "XPTO" })).rejects.toThrow(
      "wallet_ledger_entries_direction_check",
    );
  });

  it("rejeita valor zero pela constraint wallet_ledger_entries_amount_check", async () => {
    await expect(
      insertEntry({ amount: "0.00", before: "100.00", after: "100.00" }),
    ).rejects.toThrow("wallet_ledger_entries_amount_check");
  });

  it("rejeita aritmética errada pela constraint wallet_ledger_entries_arithmetic_check", async () => {
    // DEBIT de 25 deveria terminar em 75, não em 80
    await expect(insertEntry({ after: "80.00" })).rejects.toThrow(
      "wallet_ledger_entries_arithmetic_check",
    );
  });

  it("rejeita dois lançamentos da mesma transação na mesma wallet", async () => {
    await insertEntry();
    await expect(insertEntry({ id: randomUUIDv7() })).rejects.toThrow(
      "wallet_ledger_entries_wallet_transaction_key",
    );
  });

  it("aceita lançamentos de transações diferentes na mesma wallet", async () => {
    await insertEntry();
    await run(
      `insert into wagering_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, status, amount, currency, created_at)
       values (?, 'provider-a', 'tx-2', 'provider-a:tx-2', 'hash-2',
          ?, ?, 'round-1', 'game-1', 'BET', 'PROCESSED', 10.00, 'BRL', now())`,
      [TX2_ID, WALLET_ID, PLAYER_ID],
    );
    await insertEntry({ id: randomUUIDv7(), transactionId: TX2_ID, amount: "10.00",before: "75.00", after: "65.00" });
    const rows = await run("select id from wallet_ledger_entries where wallet_id = ?", [WALLET_ID]);
    expect(rows).toHaveLength(2);
  });
});

describe("imutabilidade do ledger (trigger)", () => {
  it("bloqueia UPDATE com a mensagem wallet_ledger_entries is immutable", async () => {
    await insertEntry();
    await expect(
      run("update wallet_ledger_entries set amount = 1.00 where id = ?", [ENTRY_ID]),
    ).rejects.toThrow("wallet_ledger_entries is immutable");
  });

  it("bloqueia DELETE com a mensagem wallet_ledger_entries is immutable", async () => {
    await insertEntry();
    await expect(
      run("delete from wallet_ledger_entries where id = ?", [ENTRY_ID]),
    ).rejects.toThrow("wallet_ledger_entries is immutable");
  });

  it("após a tentativa de UPDATE, o valor original continua no banco", async () => {
    await insertEntry();
    await run("update wallet_ledger_entries set amount = 1.00 where id = ?", [ENTRY_ID]).catch(() => {});
    const rows = (await run("select amount from wallet_ledger_entries where id = ?", [ENTRY_ID])) as {
      amount: string;
    }[];
    expect(rows[0]?.amount).toBe("25.00");
  });
});