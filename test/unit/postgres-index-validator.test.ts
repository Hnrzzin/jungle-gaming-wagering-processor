import { describe, expect, it } from "bun:test";
import {
  PostgreSQLIndexValidationError,
  PostgreSQLIndexValidator,
  PROCESS_WAGER_UNIQUE_INDEXES,
} from "../../src/infrastructure/database/postgres-index-validator";
import type {
  PostgreSQLQueryResult,
  PostgreSQLTransactionConnection,
} from "../../src/infrastructure/database/postgres-process-wager";

class FakeConnection implements PostgreSQLTransactionConnection {
  response: PostgreSQLQueryResult<Record<string, unknown>> = {
    rows: [],
    rowCount: 0,
  };

  release(): void {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    _sql: string,
    _parameters: readonly unknown[] = [],
  ): Promise<PostgreSQLQueryResult<T>> {
    return this.response as PostgreSQLQueryResult<T>;
  }
}

describe("PostgreSQLIndexValidator", () => {
  it("passes when all required indexes exist", async () => {
    const connection = new FakeConnection();

    connection.response = {
      rows: PROCESS_WAGER_UNIQUE_INDEXES.map((index) => ({
        index_name: index.name,
      })),
      rowCount: PROCESS_WAGER_UNIQUE_INDEXES.length,
    };

    const validator = new PostgreSQLIndexValidator(connection);

    await expect(validator.validate()).resolves.toBeUndefined();
  });

  it("reports missing indexes", async () => {
    const connection = new FakeConnection();

    connection.response = {
      rows: [
        {
          index_name:
            "wager_transactions_provider_idempotency_unique",
        },
      ],
      rowCount: 1,
    };

    const validator = new PostgreSQLIndexValidator(connection);

    let captured: unknown;

    try {
      await validator.validate();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(
      PostgreSQLIndexValidationError,
    );

    expect(
      (captured as PostgreSQLIndexValidationError).missingIndexes,
    ).toEqual([
      "wager_transactions_provider_external_unique",
      "wallet_ledger_entries_wallet_transaction_unique",
    ]);
  });
});