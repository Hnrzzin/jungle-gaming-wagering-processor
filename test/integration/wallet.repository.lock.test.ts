import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUIDv7 } from "bun";
import { Client} from "pg";
import { createOrm } from "../../src/infrastructure/database/orm";
import { Money } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { WalletRepository } from "../../src/infrastructure/database/wallet.repository";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

let orm: Awaited<ReturnType<typeof createOrm>>;

beforeAll(async () => {
  orm = await createOrm();
});

afterAll(async () => {
  await orm.close();
});

beforeEach(async () => {
  await orm.em.getConnection().execute(
    "truncate wallet_ledger_entries, wagering_transactions, wallets cascade",
  );
});

describe("WalletRepository.findByIdForUpdate", () => {
  it("mantém a linha travada até o fim da transação", async () => {
    const wallet = Wallet.open({
      id: randomUUIDv7(),
      playerId: randomUUIDv7(),
      initialBalance: brl("100.00"),
    });
    await new WalletRepository(orm.em.fork()).insert(wallet);

    // sessão separada, fora do contexto do MikroORM
    const probe = new Client({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.DB_NAME,
    });
    await probe.connect();

    try {
      await orm.em.fork().transactional(async (tx) => {
        const locked = await new WalletRepository(tx).findByIdForUpdate(wallet.id);
        expect(locked).not.toBeNull();

        await expect(
          probe.query("select id from wallets where id = $1 for update nowait", [wallet.id]),
        ).rejects.toThrow(/could not obtain lock/);
      });
    } finally {
      await probe.end();
    }
  });
});