import type {
  PostgreSQLQueryResult,
  PostgreSQLTransactionConnection,
  PostgreSQLTransactionProvider,
} from "./postgres-process-wager";

export type MikroOrmQueryMethod = "all" | "run";

export interface MikroOrmSqlConnectionLike {
  execute(
    query: string,
    parameters?: unknown[],
    method?: MikroOrmQueryMethod,
  ): Promise<unknown>;
}

export interface MikroOrmEntityManagerLike {
  transactional<T>(
    callback: (transactionalEntityManager: MikroOrmEntityManagerLike) => Promise<T>,
  ): Promise<T>;

  getConnection(): MikroOrmSqlConnectionLike;
}

function normalizeQueryResult<T extends Record<string, unknown>>(
  result: unknown,
): PostgreSQLQueryResult<T> {
  if (Array.isArray(result)) {
    return {
      rows: result as T[],
      rowCount: result.length,
    };
  }

  if (typeof result !== "object" || result === null) {
    return {
      rows: [],
      rowCount: 0,
    };
  }

  const candidate = result as {
    rows?: unknown;
    rowCount?: unknown;
    affectedRows?: unknown;
    changes?: unknown;
  };

  const rows = Array.isArray(candidate.rows)
    ? (candidate.rows as T[])
    : [];

  const possibleCount =
    typeof candidate.rowCount === "number"
      ? candidate.rowCount
      : typeof candidate.affectedRows === "number"
        ? candidate.affectedRows
        : typeof candidate.changes === "number"
          ? candidate.changes
          : rows.length;

  return {
    rows,
    rowCount: possibleCount,
  };
}

function getQueryMethod(query: string): MikroOrmQueryMethod {
  const normalized = query.trimStart().toUpperCase();

  if (
    normalized.startsWith("SELECT") ||
    normalized.startsWith("WITH") ||
    normalized.startsWith("SHOW") ||
    normalized.startsWith("EXPLAIN")
  ) {
    return "all";
  }

  return "run";
}

class MikroOrmPostgreSQLConnection
  implements PostgreSQLTransactionConnection
{
  constructor(private readonly entityManager: MikroOrmEntityManagerLike) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<PostgreSQLQueryResult<T>> {
    const method = getQueryMethod(sql);

    const result = await this.entityManager
      .getConnection()
      .execute(sql, [...parameters], method);

    return normalizeQueryResult<T>(result);
  }

  release(): void {}
}

export class MikroOrmPostgreSQLTransactionProvider
  implements PostgreSQLTransactionProvider
{
  constructor(
    private readonly entityManager: MikroOrmEntityManagerLike,
  ) {}

  transaction<T>(
    callback: (connection: PostgreSQLTransactionConnection) => Promise<T>,
  ): Promise<T> {
    return this.entityManager.transactional(
      async (transactionalEntityManager) => {
        const connection = new MikroOrmPostgreSQLConnection(
          transactionalEntityManager,
        );

        return callback(connection);
      },
    );
  }
}