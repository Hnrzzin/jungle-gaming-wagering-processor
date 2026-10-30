import { describe, expect, it } from "bun:test";
import {
  MikroOrmPostgreSQLTransactionProvider,
  type MikroOrmEntityManagerLike,
  type MikroOrmQueryMethod,
  type MikroOrmSqlConnectionLike,
} from "../../src/infrastructure/database/mikro-orm-transaction-provider";

class FakeSqlConnection implements MikroOrmSqlConnectionLike {
  readonly calls: Array<{
    query: string;
    parameters: unknown[];
    method: MikroOrmQueryMethod | undefined;
  }> = [];

  response: unknown = [];

  async execute(
    query: string,
    parameters: unknown[] = [],
    method?: MikroOrmQueryMethod,
  ): Promise<unknown> {
    this.calls.push({
      query,
      parameters,
      method,
    });

    return this.response;
  }
}

class FakeEntityManager implements MikroOrmEntityManagerLike {
  transactionCalls = 0;
  connection = new FakeSqlConnection();

  async transactional<T>(
    callback: (
      transactionalEntityManager: MikroOrmEntityManagerLike,
    ) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    return callback(this);
  }

  getConnection(): MikroOrmSqlConnectionLike {
    return this.connection;
  }
}

describe("MikroOrmPostgreSQLTransactionProvider", () => {
  it("executes operations inside a MikroORM transaction", async () => {
    const entityManager = new FakeEntityManager();
    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    const result = await provider.transaction(async () => "success");

    expect(result).toBe("success");
    expect(entityManager.transactionCalls).toBe(1);
  });

  it("uses the transactional entity manager for SQL", async () => {
    const entityManager = new FakeEntityManager();

    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    await provider.transaction(async (connection) => {
      await connection.query("SELECT 1");
    });

    expect(entityManager.connection.calls).toHaveLength(1);
    expect(entityManager.connection.calls[0]?.method).toBe("all");
  });

  it("uses run mode for updates", async () => {
    const entityManager = new FakeEntityManager();

    entityManager.connection.response = {
      affectedRows: 1,
    };

    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    await provider.transaction(async (connection) => {
      const result = await connection.query(
        "UPDATE wallets SET balance = $1 WHERE id = $2",
        ["20.00", "wallet-1"],
      );

      expect(result.rowCount).toBe(1);
    });

    expect(entityManager.connection.calls[0]?.method).toBe("run");
  });

  it("passes SQL parameters without interpolation", async () => {
    const entityManager = new FakeEntityManager();

    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    await provider.transaction(async (connection) => {
      await connection.query(
        "SELECT * FROM wallets WHERE id = $1",
        ["wallet-1"],
      );
    });

    expect(entityManager.connection.calls[0]?.query).toContain("?");
    expect(entityManager.connection.calls[0]?.query).not.toContain("$1");
    expect(
      entityManager.connection.calls[0]?.parameters,
    ).toEqual(["wallet-1"]);
  });


  it("converts numbered PostgreSQL placeholders and preserves parameter order", async () => {
    const entityManager = new FakeEntityManager();
    const provider = new MikroOrmPostgreSQLTransactionProvider(entityManager);

    await provider.transaction(async (connection) => {
      await connection.query(
        "SELECT $2 AS second, $1 AS first",
        ["first-value", "second-value"],
      );
    });

    expect(entityManager.connection.calls[0]?.query).toBe(
      "SELECT ? AS second, ? AS first",
    );
    expect(entityManager.connection.calls[0]?.parameters).toEqual([
      "second-value",
      "first-value",
    ]);
  });

  it("rejects SQL placeholders without matching parameters", async () => {
    const entityManager = new FakeEntityManager();
    const provider = new MikroOrmPostgreSQLTransactionProvider(entityManager);

    await expect(
      provider.transaction(async (connection) => {
        await connection.query("SELECT $1", []);
      }),
    ).rejects.toThrow("SQL placeholder $1 has no matching parameter");
  });

  it("normalizes array results", async () => {
    const entityManager = new FakeEntityManager();

    entityManager.connection.response = [
      { id: "wallet-1" },
      { id: "wallet-2" },
    ];

    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    await provider.transaction(async (connection) => {
      const result = await connection.query<{ id: string }>(
        "SELECT id FROM wallets",
      );

      expect(result.rows).toEqual([
        { id: "wallet-1" },
        { id: "wallet-2" },
      ]);

      expect(result.rowCount).toBe(2);
    });
  });

  it("normalizes object query results", async () => {
    const entityManager = new FakeEntityManager();

    entityManager.connection.response = {
      rows: [{ id: "wallet-1" }],
      rowCount: 1,
    };

    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    await provider.transaction(async (connection) => {
      const result = await connection.query<{ id: string }>(
        "SELECT id FROM wallets",
      );

      expect(result.rows).toEqual([{ id: "wallet-1" }]);
      expect(result.rowCount).toBe(1);
    });
  });

  it("propagates transaction errors", async () => {
    const entityManager = new FakeEntityManager();

    const provider = new MikroOrmPostgreSQLTransactionProvider(
      entityManager,
    );

    await expect(
      provider.transaction(async () => {
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    expect(entityManager.transactionCalls).toBe(1);
  });
});