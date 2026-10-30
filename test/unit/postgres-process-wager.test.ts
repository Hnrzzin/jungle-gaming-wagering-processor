import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PROCESS_WAGER_SCHEMA,
  PostgreSQLProcessWagerUnitOfWork,
  type ProcessWagerDatabaseSchema,
  type PostgreSQLQueryResult,
  type PostgreSQLTransactionConnection,
} from "../../src/infrastructure/database/postgres-process-wager";

class QueryRecorder implements PostgreSQLTransactionConnection {
  readonly calls: Array<{
    sql: string;
    parameters: readonly unknown[];
  }> = [];

  readonly results: PostgreSQLQueryResult<Record<string, unknown>>[] = [];

  release(): void {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgreSQLQueryResult<T>> {
    this.calls.push({ sql, parameters });

    const next = this.results.shift() ?? {
      rows: [],
      rowCount: 0,
    };

    return next as PostgreSQLQueryResult<T>;
  }
}

describe("PostgreSQLProcessWagerUnitOfWork", () => {
  it("locks wallet row using SELECT FOR UPDATE", async () => {
    const connection = new QueryRecorder();

    connection.results.push({
      rows: [
        {
          id: "wallet-1",
          player_id: "player-1",
          currency: "BRL",
          balance: "100.00",
          version: 1,
        },
      ],
      rowCount: 1,
    });

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      DEFAULT_PROCESS_WAGER_SCHEMA,
    );

    const wallet = await unitOfWork.findWalletByIdForUpdate("wallet-1");

    expect(wallet).toEqual({
      id: "wallet-1",
      playerId: "player-1",
      currency: "BRL",
      balance: {
        amount: "100.00",
        currency: "BRL",
      },
      version: 1,
    });

    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.parameters).toEqual(["wallet-1"]);
  });

  it("returns null when wallet does not exist", async () => {
    const connection = new QueryRecorder();

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      DEFAULT_PROCESS_WAGER_SCHEMA,
    );

    expect(
      await unitOfWork.findWalletByIdForUpdate("missing"),
    ).toBeNull();
  });

  it("updates wallet balance using the expected version", async () => {
    const connection = new QueryRecorder();

    connection.results.push({
      rows: [],
      rowCount: 1,
    });

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      DEFAULT_PROCESS_WAGER_SCHEMA,
    );

    await unitOfWork.updateWalletBalance({
      walletId: "wallet-1",
      balance: {
        amount: "20.00",
        currency: "BRL",
      },
      expectedVersion: 1,
      newVersion: 2,
    });

    expect(connection.calls[0]?.sql).toContain("version");
    expect(connection.calls[0]?.sql).toContain("WHERE");
    expect(connection.calls[0]?.parameters).toEqual([
      "20.00",
      2,
      "wallet-1",
      1,
    ]);
  });

  it("fails when wallet update affects no rows", async () => {
    const connection = new QueryRecorder();

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      DEFAULT_PROCESS_WAGER_SCHEMA,
    );

    await expect(
      unitOfWork.updateWalletBalance({
        walletId: "wallet-1",
        balance: {
          amount: "20.00",
          currency: "BRL",
        },
        expectedVersion: 1,
        newVersion: 2,
      }),
    ).rejects.toThrow("expected one row");
  });

  it("inserts a processed wager with parameterized values", async () => {
    const connection = new QueryRecorder();

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      DEFAULT_PROCESS_WAGER_SCHEMA,
    );

    const wager = await unitOfWork.insertWager({
      id: "wager-1",
      providerId: "provider-1",
      playerId: "player-1",
      walletId: "wallet-1",
      externalTransactionId: "external-1",
      idempotencyKey: "key-1",
      payloadHash: "a".repeat(64),
      type: "BET",
      status: "PROCESSED",
      amount: {
        amount: "80.00",
        currency: "BRL",
      },
      failureCode: null,
    });

    expect(wager.id).toBe("wager-1");
    expect(connection.calls[0]?.sql).toContain("INSERT INTO");
    expect(connection.calls[0]?.sql).not.toContain("provider-1");
    expect(connection.calls[0]?.parameters).toContain("provider-1");
  });

  it("inserts a debit ledger entry", async () => {
    const connection = new QueryRecorder();

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      DEFAULT_PROCESS_WAGER_SCHEMA,
    );

    const ledger = await unitOfWork.insertLedger({
      id: "ledger-1",
      walletId: "wallet-1",
      transactionId: "wager-1",
      direction: "DEBIT",
      amount: {
        amount: "80.00",
        currency: "BRL",
      },
      balanceBefore: {
        amount: "100.00",
        currency: "BRL",
      },
      balanceAfter: {
        amount: "20.00",
        currency: "BRL",
      },
    });

    expect(ledger.id).toBe("ledger-1");
    expect(connection.calls[0]?.sql).toContain("INSERT INTO");
    expect(connection.calls[0]?.parameters).toContain("80.00");
  });

  it("rejects an unsafe table name when executing a query", async () => {
    const connection = new QueryRecorder();

    const unsafeSchema: ProcessWagerDatabaseSchema = {
      ...DEFAULT_PROCESS_WAGER_SCHEMA,
      tables: {
        ...DEFAULT_PROCESS_WAGER_SCHEMA.tables,
        wallets: "wallets; DROP TABLE wallets",
      },
    };

    const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
      connection,
      unsafeSchema,
    );

    await expect(
      unitOfWork.findWalletByIdForUpdate("wallet-1"),
    ).rejects.toThrow("Invalid SQL identifier");

    expect(connection.calls).toHaveLength(0);
  });
});