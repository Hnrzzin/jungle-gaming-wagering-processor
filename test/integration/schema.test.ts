import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createOrm } from "../../src/infrastructure/database/orm";

const WALLET_ID = "0192f291-27dd-7d3f-8071-5f8685deef37";
const PLAYER_ID = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1";

describe("schema do PostgreSQL: tabela wallets", () => {
  let orm: Awaited<ReturnType<typeof createOrm>>;

  beforeAll(async () => {
    orm = await createOrm();
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute("truncate wallet_ledger_entries, wagering_transactions, wallets cascade");
    
  });

  afterAll(async () => {
    await orm?.close();
  });

  it("rejeita saldo negativo pela constraint wallets_balance_check", async () => {
    const connection = orm.em.getConnection();

    await expect(
      connection.execute(
        `insert into wallets (id, player_id, currency, balance, version, created_at)
         values ('${WALLET_ID}', '${PLAYER_ID}', 'BRL', -10.00, 1, '2026-10-28')`
      )
    ).rejects.toThrow("wallets_balance_check");
  });

  it("aceita saldo zero", async () => {
    const connection = orm.em.getConnection();

    await connection.execute(
      `insert into wallets (id, player_id, currency, balance, version, created_at)
       values ('${WALLET_ID}', '${PLAYER_ID}', 'BRL', 0.00, 1, '2026-10-28')`
    );

    const rows = await connection.execute("select balance from wallets");
    expect(rows).toHaveLength(1);
  });
});