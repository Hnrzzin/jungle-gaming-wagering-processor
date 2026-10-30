import { describe, expect, it } from "bun:test";
import {
  PostgreSQLPoolTransactionProvider,
  type PostgreSQLClientLike,
  type PostgreSQLPoolLike,
} from "../../src/infrastructure/database/postgres-transaction-provider";

class FakeClient implements PostgreSQLClientLike {
  readonly queries: string[] = [];
  released = false;
  failCommit = false;
  failRollback = false;

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<{
    rows: T[];
    rowCount: number;
  }> {
    this.queries.push(sql);

    if (sql === "COMMIT" && this.failCommit) {
      throw new Error("commit failed");
    }

    if (sql === "ROLLBACK" && this.failRollback) {
      throw new Error("rollback failed");
    }

    return {
      rows: [],
      rowCount: 0,
    };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements PostgreSQLPoolLike {
  constructor(readonly client: FakeClient) {}

  async connect(): Promise<PostgreSQLClientLike> {
    return this.client;
  }
}

describe("PostgreSQLPoolTransactionProvider", () => {
  it("commits after a successful callback", async () => {
    const client = new FakeClient();
    const provider = new PostgreSQLPoolTransactionProvider(
      new FakePool(client),
    );

    const result = await provider.transaction(async () => "success");

    expect(result).toBe("success");
    expect(client.queries).toEqual(["BEGIN", "COMMIT"]);
    expect(client.released).toBe(true);
  });

  it("rolls back after a callback failure", async () => {
    const client = new FakeClient();
    const provider = new PostgreSQLPoolTransactionProvider(
      new FakePool(client),
    );

    await expect(
      provider.transaction(async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");

    expect(client.queries).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });

  it("releases the connection after a commit failure", async () => {
    const client = new FakeClient();
    client.failCommit = true;

    const provider = new PostgreSQLPoolTransactionProvider(
      new FakePool(client),
    );

    await expect(
      provider.transaction(async () => "success"),
    ).rejects.toThrow("commit failed");

    expect(client.queries).toEqual([
      "BEGIN",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(client.released).toBe(true);
  });

  it("reports both operation and rollback failures", async () => {
    const client = new FakeClient();
    client.failRollback = true;

    const provider = new PostgreSQLPoolTransactionProvider(
      new FakePool(client),
    );

    let captured: unknown;

    try {
      await provider.transaction(async () => {
        throw new Error("operation failed");
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(AggregateError);

    const aggregate = captured as AggregateError;

    expect(aggregate.errors).toHaveLength(2);
    expect(client.released).toBe(true);
  });

  it("releases the connection after a successful transaction", async () => {
    const client = new FakeClient();
    const provider = new PostgreSQLPoolTransactionProvider(
      new FakePool(client),
    );

    await provider.transaction(async () => undefined);

    expect(client.released).toBe(true);
  });
});