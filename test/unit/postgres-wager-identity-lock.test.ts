import { describe, expect, it } from "bun:test";
import {
  PostgreSQLWagerIdentityLock,
  type PostgreSQLQueryExecutor,
} from "../../src/infrastructure/database/postgres-wager-identity-lock";

class QueryRecorder implements PostgreSQLQueryExecutor {
  readonly calls: Array<{
    query: string;
    parameters: readonly unknown[];
  }> = [];

  async execute(
    query: string,
    parameters: readonly unknown[],
  ): Promise<unknown> {
    this.calls.push({ query, parameters });
    return [];
  }
}

describe("PostgreSQLWagerIdentityLock", () => {
  it("acquires two transaction-scoped advisory locks", async () => {
    const executor = new QueryRecorder();
    const lock = new PostgreSQLWagerIdentityLock(executor);

    await lock.acquire({
      providerId: "provider-1",
      idempotencyKey: "key-1",
      externalTransactionId: "external-1",
    });

    expect(executor.calls).toHaveLength(2);

    for (const call of executor.calls) {
      expect(call.query).toContain("pg_advisory_xact_lock");
      expect(call.query).toContain("hashtextextended");
      expect(call.query).toContain("$1");
      expect(call.parameters).toHaveLength(1);
    }
  });

  it("acquires locks in deterministic order", async () => {
    const firstExecutor = new QueryRecorder();
    const secondExecutor = new QueryRecorder();

    const firstLock = new PostgreSQLWagerIdentityLock(firstExecutor);
    const secondLock = new PostgreSQLWagerIdentityLock(secondExecutor);

    const input = {
      providerId: "provider-1",
      idempotencyKey: "key-1",
      externalTransactionId: "external-1",
    };

    await firstLock.acquire(input);
    await secondLock.acquire(input);

    expect(firstExecutor.calls.map((call) => call.parameters)).toEqual(
      secondExecutor.calls.map((call) => call.parameters),
    );
  });

  it("uses provider and identity namespace in each lock key", async () => {
    const executor = new QueryRecorder();
    const lock = new PostgreSQLWagerIdentityLock(executor);

    await lock.acquire({
      providerId: "provider-1",
      idempotencyKey: "same-value",
      externalTransactionId: "same-value",
    });

    const keys = executor.calls.map(
      (call) => call.parameters[0] as string,
    );

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => key.includes("provider-1"))).toBe(true);
  });
});