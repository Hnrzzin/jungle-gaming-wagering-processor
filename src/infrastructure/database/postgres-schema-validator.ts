import type {
  PostgreSQLTransactionConnection,
} from "./postgres-process-wager";

export interface PostgreSQLSchemaRequirement {
  readonly table: string;
  readonly columns: readonly string[];
}

export class PostgreSQLSchemaValidationError extends Error {
  readonly missingTables: string[];
  readonly missingColumns: Array<{
    table: string;
    column: string;
  }>;

  constructor(
    missingTables: string[],
    missingColumns: Array<{
      table: string;
      column: string;
    }>,
  ) {
    super("PostgreSQL schema does not satisfy application requirements");
    this.name = "PostgreSQLSchemaValidationError";
    this.missingTables = missingTables;
    this.missingColumns = missingColumns;
  }
}

export class PostgreSQLSchemaValidator {
  constructor(
    private readonly connection: PostgreSQLTransactionConnection,
    private readonly requirements: readonly PostgreSQLSchemaRequirement[],
  ) {}

  async validate(): Promise<void> {
    const requiredTables = this.requirements.map(
      (requirement) => requirement.table,
    );

    const tableResult = await this.connection.query<{
      table_name: string;
    }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [requiredTables],
    );

    const existingTables = new Set(
      tableResult.rows.map((row) => row.table_name),
    );

    const missingTables = requiredTables.filter(
      (table) => !existingTables.has(table),
    );

    const columnRequirements = this.requirements.flatMap(
      (requirement) =>
        requirement.columns.map((column) => ({
          table: requirement.table,
          column,
        })),
    );

    const columnResult = await this.connection.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [requiredTables],
    );

    const existingColumns = new Set(
      columnResult.rows.map(
        (row) => `${row.table_name}.${row.column_name}`,
      ),
    );

    const missingColumns = columnRequirements.filter(
      ({ table, column }) =>
        existingTables.has(table) &&
        !existingColumns.has(`${table}.${column}`),
    );

    if (
      missingTables.length > 0 ||
      missingColumns.length > 0
    ) {
      throw new PostgreSQLSchemaValidationError(
        missingTables,
        missingColumns,
      );
    }
  }
}