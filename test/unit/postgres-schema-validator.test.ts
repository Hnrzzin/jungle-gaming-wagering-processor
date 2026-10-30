import { describe, expect, it } from "bun:test";
import {
  PostgreSQLSchemaValidationError,
  PostgreSQLSchemaValidator,
} from "../../src/infrastructure/database/postgres-schema-validator";
import type {
  PostgreSQLQueryResult,
  PostgreSQLTransactionConnection,
} from "../../src/infrastructure/database/postgres-process-wager";

class FakeConnection implements PostgreSQLTransactionConnection {
  readonly calls: Array<{
    sql: string;
    parameters: readonly unknown[];
  }> = [];

  readonly responses: PostgreSQLQueryResult<Record<string, unknown>>[] = [];

  release(): void {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgreSQLQueryResult<T>> {
    this.calls.push({ sql, parameters });

    return (this.responses.shift() ?? {
      rows: [],
      rowCount: 0,
    }) as PostgreSQLQueryResult<T>;
  }
}

describe("PostgreSQLSchemaValidator", () => {
  const requirements = [
    {
      table: "wallets",
      columns: ["id", "player_id", "balance", "currency", "version"],
    },
    {
      table: "wager_transactions",
      columns: [
        "id",
        "provider_id",
        "idempotency_key",
        "external_transaction_id",
        "payload_hash",
        "failure_code",
      ],
    },
  ];

  it("passes when all required tables and columns exist", async () => {
    const connection = new FakeConnection();

    connection.responses.push({
      rows: [
        { table_name: "wallets" },
        { table_name: "wager_transactions" },
      ],
      rowCount: 2,
    });

    connection.responses.push({
      rows: [
        ...requirements.flatMap((requirement) =>
          requirement.columns.map((column) => ({
            table_name: requirement.table,
            column_name: column,
          })),
        ),
      ],
      rowCount: 11,
    });

    const validator = new PostgreSQLSchemaValidator(
      connection,
      requirements,
    );

    await expect(validator.validate()).resolves.toBeUndefined();
  });

  it("reports missing tables", async () => {
    const connection = new FakeConnection();

    connection.responses.push({
      rows: [{ table_name: "wallets" }],
      rowCount: 1,
    });

    connection.responses.push({
      rows: [],
      rowCount: 0,
    });

    const validator = new PostgreSQLSchemaValidator(
      connection,
      requirements,
    );

    let captured: unknown;

    try {
      await validator.validate();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(
      PostgreSQLSchemaValidationError,
    );

    expect(
      (captured as PostgreSQLSchemaValidationError).missingTables,
    ).toEqual(["wager_transactions"]);
  });

  it("reports missing columns", async () => {
    const connection = new FakeConnection();

    connection.responses.push({
      rows: [
        { table_name: "wallets" },
        { table_name: "wager_transactions" },
      ],
      rowCount: 2,
    });

    connection.responses.push({
      rows: [
        { table_name: "wallets", column_name: "id" },
        { table_name: "wallets", column_name: "player_id" },
        { table_name: "wallets", column_name: "balance" },
        { table_name: "wallets", column_name: "currency" },
        { table_name: "wallets", column_name: "version" },
        { table_name: "wager_transactions", column_name: "id" },
      ],
      rowCount: 6,
    });

    const validator = new PostgreSQLSchemaValidator(
      connection,
      requirements,
    );

    let captured: unknown;

    try {
      await validator.validate();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(
      PostgreSQLSchemaValidationError,
    );

    expect(
      (captured as PostgreSQLSchemaValidationError).missingColumns,
    ).toContainEqual({
      table: "wager_transactions",
      column: "provider_id",
    });
  });
});