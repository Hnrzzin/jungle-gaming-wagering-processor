import type {
  CreateLedgerRecordInput,
  CreateWagerRecordInput,
  LedgerRecord,
  MoneyValue,
  ProcessWagerTransactionManager,
  ProcessWagerUnitOfWork,
  WagerIdentity,
  WagerRecord,
  WalletRecord,
} from "../../application/use-cases/process-wager";
import { PostgreSQLWagerIdentityLock } from "./postgres-wager-identity-lock";

export interface PostgreSQLQueryResult<T> {
  readonly rows: T[];
  readonly rowCount: number;
}

export interface PostgreSQLTransactionConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<PostgreSQLQueryResult<T>>;
  release(): void;
}

export interface PostgreSQLTransactionProvider {
  transaction<T>(
    callback: (connection: PostgreSQLTransactionConnection) => Promise<T>,
  ): Promise<T>;
}

export interface ProcessWagerDatabaseSchema {
  readonly tables: {
    readonly wallets: string;
    readonly wagerTransactions: string;
    readonly ledgerEntries: string;
  };
  readonly wallet: {
    readonly id: string;
    readonly playerId: string;
    readonly currency: string;
    readonly balance: string;
    readonly version: string;
  };
  readonly wagerTransaction: {
    readonly id: string;
    readonly providerId: string;
    readonly playerId: string;
    readonly walletId: string;
    readonly externalTransactionId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly roundId: string;
    readonly gameId: string;
    readonly type: string;
    readonly status: string;
    readonly amount: string;
    readonly currency: string;
    readonly failureCode: string;
  };
  readonly ledgerEntry: {
    readonly id: string;
    readonly walletId: string;
    readonly transactionId: string;
    readonly direction: string;
    readonly amount: string;
    readonly currency: string;
    readonly balanceBefore: string;
    readonly balanceAfter: string;
  };
}

export const DEFAULT_PROCESS_WAGER_SCHEMA: ProcessWagerDatabaseSchema = {
  tables: {
    wallets: "wallets",
    wagerTransactions: "wagering_transactions",
    ledgerEntries: "wallet_ledger_entries",
  },
  wallet: {
    id: "id",
    playerId: "player_id",
    currency: "currency",
    balance: "balance",
    version: "version",
  },
  wagerTransaction: {
    id: "id",
    providerId: "provider_id",
    playerId: "player_id",
    walletId: "wallet_id",
    externalTransactionId: "external_transaction_id",
    idempotencyKey: "idempotency_key",
    payloadHash: "payload_hash",
    roundId: "round_id",
    gameId: "game_id",
    type: "kind",
    status: "status",
    amount: "amount",
    currency: "currency",
    failureCode: "failure_code",
  },
  ledgerEntry: {
    id: "id",
    walletId: "wallet_id",
    transactionId: "transaction_id",
    direction: "direction",
    amount: "amount",
    currency: "currency",
    balanceBefore: "balance_before",
    balanceAfter: "balance_after",
  },
};

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function qualifiedTable(table: string): string {
  return table
    .split(".")
    .map(quoteIdentifier)
    .join(".");
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new Error(`Database column ${key} was not a string`);
  }

  return value;
}

function requiredInteger(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);

    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Database column ${key} was not a safe integer`);
}

function nullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Database column ${key} was not a string or null`);
  }

  return value;
}

export class PostgreSQLProcessWagerUnitOfWork
  implements ProcessWagerUnitOfWork
{
  private readonly identityLock: PostgreSQLWagerIdentityLock;

  constructor(
    private readonly connection: PostgreSQLTransactionConnection,
    private readonly schema: ProcessWagerDatabaseSchema,
  ) {
    this.identityLock = new PostgreSQLWagerIdentityLock({
      execute: async (query, parameters) => {
        await this.connection.query(query, parameters);
      },
    });
  }

  async lockWagerIdentity(identity: WagerIdentity): Promise<void> {
    await this.identityLock.acquire(identity);
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerRecord | null> {
    const table = qualifiedTable(this.schema.tables.wagerTransactions);
    const columns = this.schema.wagerTransaction;

    const result = await this.connection.query(
      `SELECT
        ${quoteIdentifier(columns.id)} AS id,
        ${quoteIdentifier(columns.providerId)} AS provider_id,
        ${quoteIdentifier(columns.playerId)} AS player_id,
        ${quoteIdentifier(columns.walletId)} AS wallet_id,
        ${quoteIdentifier(columns.externalTransactionId)} AS external_transaction_id,
        ${quoteIdentifier(columns.idempotencyKey)} AS idempotency_key,
        ${quoteIdentifier(columns.payloadHash)} AS payload_hash,
        ${quoteIdentifier(columns.roundId)} AS round_id,
        ${quoteIdentifier(columns.gameId)} AS game_id,
        ${quoteIdentifier(columns.type)} AS type,
        ${quoteIdentifier(columns.status)} AS status,
        ${quoteIdentifier(columns.amount)} AS amount,
        ${quoteIdentifier(columns.currency)} AS currency,
        ${quoteIdentifier(columns.failureCode)} AS failure_code
      FROM ${table}
      WHERE ${quoteIdentifier(columns.providerId)} = $1
        AND ${quoteIdentifier(columns.idempotencyKey)} = $2
      LIMIT 1`,
      [providerId, idempotencyKey],
    );

    return result.rows[0]
      ? this.mapWager(result.rows[0])
      : null;
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerRecord | null> {
    const table = qualifiedTable(this.schema.tables.wagerTransactions);
    const columns = this.schema.wagerTransaction;

    const result = await this.connection.query(
      `SELECT
        ${quoteIdentifier(columns.id)} AS id,
        ${quoteIdentifier(columns.providerId)} AS provider_id,
        ${quoteIdentifier(columns.playerId)} AS player_id,
        ${quoteIdentifier(columns.walletId)} AS wallet_id,
        ${quoteIdentifier(columns.externalTransactionId)} AS external_transaction_id,
        ${quoteIdentifier(columns.idempotencyKey)} AS idempotency_key,
        ${quoteIdentifier(columns.payloadHash)} AS payload_hash,
        ${quoteIdentifier(columns.roundId)} AS round_id,
        ${quoteIdentifier(columns.gameId)} AS game_id,
        ${quoteIdentifier(columns.type)} AS type,
        ${quoteIdentifier(columns.status)} AS status,
        ${quoteIdentifier(columns.amount)} AS amount,
        ${quoteIdentifier(columns.currency)} AS currency,
        ${quoteIdentifier(columns.failureCode)} AS failure_code
      FROM ${table}
      WHERE ${quoteIdentifier(columns.providerId)} = $1
        AND ${quoteIdentifier(columns.externalTransactionId)} = $2
      LIMIT 1`,
      [providerId, externalTransactionId],
    );

    return result.rows[0]
      ? this.mapWager(result.rows[0])
      : null;
  }

  async findWalletByIdForUpdate(
    walletId: string,
  ): Promise<WalletRecord | null> {
    const table = qualifiedTable(this.schema.tables.wallets);
    const columns = this.schema.wallet;

    const result = await this.connection.query(
      `SELECT
        ${quoteIdentifier(columns.id)} AS id,
        ${quoteIdentifier(columns.playerId)} AS player_id,
        ${quoteIdentifier(columns.currency)} AS currency,
        ${quoteIdentifier(columns.balance)} AS balance,
        ${quoteIdentifier(columns.version)} AS version
      FROM ${table}
      WHERE ${quoteIdentifier(columns.id)} = $1
      FOR UPDATE`,
      [walletId],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    const currency = requiredString(row, "currency");

    return {
      id: requiredString(row, "id"),
      playerId: requiredString(row, "player_id"),
      currency,
      balance: {
        amount: requiredString(row, "balance"),
        currency,
      },
      version: requiredInteger(row, "version"),
    };
  }

  async insertWager(
    record: CreateWagerRecordInput,
  ): Promise<WagerRecord> {
    const table = qualifiedTable(this.schema.tables.wagerTransactions);
    const columns = this.schema.wagerTransaction;

    const columnNames = [
      columns.id,
      columns.providerId,
      columns.playerId,
      columns.walletId,
      columns.externalTransactionId,
      columns.idempotencyKey,
      columns.payloadHash,
    ];

    const values: unknown[] = [
      record.id,
      record.providerId,
      record.playerId,
      record.walletId,
      record.externalTransactionId,
      record.idempotencyKey,
      record.payloadHash,
    ];

    if (record.roundId !== undefined) {
      columnNames.push(columns.roundId);
      values.push(record.roundId);
    }

    if (record.gameId !== undefined) {
      columnNames.push(columns.gameId);
      values.push(record.gameId);
    }

    columnNames.push(
      columns.type,
      columns.status,
      columns.amount,
      columns.currency,
      columns.failureCode,
    );
    values.push(
      record.type,
      record.status,
      record.amount.amount,
      record.amount.currency,
      record.failureCode,
    );

    const quotedColumns = columnNames.map(quoteIdentifier).join(", ");
    const placeholders = values
      .map((_, index) => `$${index + 1}`)
      .join(", ");

    await this.connection.query(
      `INSERT INTO ${table} (${quotedColumns})
       VALUES (${placeholders})`,
      values,
    );

    return { ...record };
  }

  async updateWalletBalance(input: {
    walletId: string;
    balance: MoneyValue;
    expectedVersion: number;
    newVersion: number;
  }): Promise<void> {
    const table = qualifiedTable(this.schema.tables.wallets);
    const columns = this.schema.wallet;

    const result = await this.connection.query(
      `UPDATE ${table}
       SET
         ${quoteIdentifier(columns.balance)} = $1,
         ${quoteIdentifier(columns.version)} = $2
       WHERE ${quoteIdentifier(columns.id)} = $3
         AND ${quoteIdentifier(columns.version)} = $4`,
      [
        input.balance.amount,
        input.newVersion,
        input.walletId,
        input.expectedVersion,
      ],
    );

    if (result.rowCount !== 1) {
      throw new Error(
        `Wallet balance update expected one row, received ${result.rowCount}`,
      );
    }
  }

  async insertLedger(
    record: CreateLedgerRecordInput,
  ): Promise<LedgerRecord> {
    const table = qualifiedTable(this.schema.tables.ledgerEntries);
    const columns = this.schema.ledgerEntry;

    const columnNames = [
      columns.id,
      columns.walletId,
      columns.transactionId,
      columns.direction,
      columns.amount,
      columns.currency,
      columns.balanceBefore,
      columns.balanceAfter,
    ];

    const values = [
      record.id,
      record.walletId,
      record.transactionId,
      record.direction,
      record.amount.amount,
      record.amount.currency,
      record.balanceBefore.amount,
      record.balanceAfter.amount,
    ];

    const quotedColumns = columnNames.map(quoteIdentifier).join(", ");
    const placeholders = values
      .map((_, index) => `$${index + 1}`)
      .join(", ");

    await this.connection.query(
      `INSERT INTO ${table} (${quotedColumns})
       VALUES (${placeholders})`,
      values,
    );

    return { ...record };
  }

  private mapWager(
    row: Record<string, unknown>,
  ): WagerRecord {
    const amountCurrency = requiredString(row, "currency");
    const failureCode = nullableString(row, "failure_code");
    const roundId = nullableString(row, "round_id");
    const gameId = nullableString(row, "game_id");
    const type = requiredString(row, "type");
    const status = requiredString(row, "status");

    if (type !== "BET") {
      throw new Error(`Unsupported wager type: ${type}`);
    }

    if (status !== "PROCESSED" && status !== "REJECTED") {
      throw new Error(`Unsupported wager status: ${status}`);
    }

    if (
      failureCode !== null &&
      failureCode !== "INSUFFICIENT_FUNDS"
    ) {
      throw new Error(`Unsupported failure code: ${failureCode}`);
    }

    return {
      id: requiredString(row, "id"),
      providerId: requiredString(row, "provider_id"),
      playerId: requiredString(row, "player_id"),
      walletId: requiredString(row, "wallet_id"),
      ...(roundId === null ? {} : { roundId }),
      ...(gameId === null ? {} : { gameId }),
      externalTransactionId: requiredString(
        row,
        "external_transaction_id",
      ),
      idempotencyKey: requiredString(row, "idempotency_key"),
      payloadHash: requiredString(row, "payload_hash"),
      type,
      status,
      amount: {
        amount: requiredString(row, "amount"),
        currency: amountCurrency,
      },
      failureCode,
    };
  }
}

export class PostgreSQLProcessWagerTransactionManager
  implements ProcessWagerTransactionManager
{
  constructor(
    private readonly provider: PostgreSQLTransactionProvider,
    private readonly schema: ProcessWagerDatabaseSchema =
      DEFAULT_PROCESS_WAGER_SCHEMA,
  ) {}

  transaction<T>(
    operation: (unitOfWork: ProcessWagerUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return this.provider.transaction(async (connection) => {
      const unitOfWork = new PostgreSQLProcessWagerUnitOfWork(
        connection,
        this.schema,
      );

      return operation(unitOfWork);
    });
  }
}