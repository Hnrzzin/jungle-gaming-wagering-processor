import type {
  PostgreSQLTransactionConnection,
  PostgreSQLTransactionProvider,
  PostgreSQLQueryResult,
} from "./postgres-process-wager";

export interface PostgreSQLClientLike {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;

  release(): void;
}

export interface PostgreSQLPoolLike {
  connect(): Promise<PostgreSQLClientLike>;
}

class PostgreSQLConnectionAdapter
  implements PostgreSQLTransactionConnection
{
  constructor(private readonly client: PostgreSQLClientLike) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgreSQLQueryResult<T>> {
    const result = await this.client.query<T>(sql, parameters);

    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  release(): void {
    this.client.release();
  }
}

export class PostgreSQLPoolTransactionProvider
  implements PostgreSQLTransactionProvider
{
  constructor(private readonly pool: PostgreSQLPoolLike) {}

  async transaction<T>(
    callback: (connection: PostgreSQLTransactionConnection) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const connection = new PostgreSQLConnectionAdapter(client);

    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const result = await callback(connection);

      await client.query("COMMIT");
      transactionStarted = false;

      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Transaction failed and rollback also failed",
          );
        }
      }

      throw error;
    } finally {
      connection.release();
    }
  }
}