import type {
  PostgreSQLTransactionConnection,
} from "./postgres-process-wager";

export interface UniqueIndexRequirement {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
}

export class PostgreSQLIndexValidationError extends Error {
  constructor(
    readonly missingIndexes: readonly string[],
  ) {
    super(
      `Missing required unique indexes: ${missingIndexes.join(", ")}`,
    );
    this.name = "PostgreSQLIndexValidationError";
  }
}

export const PROCESS_WAGER_UNIQUE_INDEXES: readonly UniqueIndexRequirement[] = [
  {
    name: "wagering_transactions_provider_idempotency_key",
    table: "wagering_transactions",
    columns: ["provider_id", "idempotency_key"],
  },
  {
    name: "wagering_transactions_provider_external_key",
    table: "wagering_transactions",
    columns: ["provider_id", "external_transaction_id"],
  },
  {
    name: "wallet_ledger_entries_wallet_transaction_key",
    table: "wallet_ledger_entries",
    columns: ["wallet_id", "transaction_id"],
  },
];

export class PostgreSQLIndexValidator {
  constructor(
    private readonly connection: PostgreSQLTransactionConnection,
    private readonly requirements: readonly UniqueIndexRequirement[] =
      PROCESS_WAGER_UNIQUE_INDEXES,
  ) {}

  async validate(): Promise<void> {
    const names = this.requirements.map(
      (requirement) => requirement.name,
    );

    const result = await this.connection.query<{
      index_name: string;
    }>(
      `SELECT indexname AS index_name
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = ANY($1::text[])`,
      [names],
    );

    const existing = new Set(
      result.rows.map((row) => row.index_name),
    );

    const missing = names.filter((name) => !existing.has(name));

    if (missing.length > 0) {
      throw new PostgreSQLIndexValidationError(missing);
    }
  }
}