import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PROCESS_WAGER_SCHEMA,
  PostgreSQLProcessWagerTransactionManager,
  type PostgreSQLQueryResult,
  type PostgreSQLTransactionConnection,
  type PostgreSQLTransactionProvider,
  type ProcessWagerDatabaseSchema,
} from "../../src/infrastructure/database/postgres-process-wager";
import { ProcessWager } from "../../src/application/use-cases/process-wager";
import { DecimalMoneyArithmetic } from "../../src/application/services/decimal-money-arithmetic";
import { UuidIdGenerator } from "../../src/application/services/uuid-id-generator";

class SchemaScopedTransactionProvider
  implements PostgreSQLTransactionProvider
{
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async transaction<T>(
    callback: (connection: PostgreSQLTransactionConnection) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    const connection: PostgreSQLTransactionConnection = {
      query: async <R extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<PostgreSQLQueryResult<R>> => {
        const result = await client.query(
          sql,
          [...parameters],
        );

        return {
          rows: result.rows as R[],
          rowCount: result.rowCount ?? result.rows.length,
        };
      },
      release: () => undefined,
    };

    try {
      await client.query(`SET search_path TO "${this.schema}"`);
      await client.query("BEGIN");
      transactionStarted = true;

      const result = await callback(connection);

      await client.query("COMMIT");
      transactionStarted = false;

      return result;
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      throw error;
    } finally {
      client.release();
    }
  }
}

const enabled =
  Boolean(process.env.POSTGRES_USER) &&
  Boolean(process.env.DB_NAME);

const integrationDescribe = enabled ? describe : describe.skip;

integrationDescribe(
  "ProcessWager PostgreSQL concurrency",
  () => {
    let pool: Pool;
    let schemaName: string;
    let manager: PostgreSQLProcessWagerTransactionManager;
    let schema: ProcessWagerDatabaseSchema;

    const createUseCase = () =>
      new ProcessWager(
        manager,
        new DecimalMoneyArithmetic(),
        new UuidIdGenerator(),
      );

    const createWallet = async (
      walletId: string,
      balance: string,
      playerId = "player-1",
      currency = "BRL",
    ) => {
      const client = await pool.connect();

      try {
        await client.query(
          `INSERT INTO "${schemaName}".wallets
            (id, player_id, currency, balance, version)
           VALUES ($1, $2, $3, $4, 1)`,
          [walletId, playerId, currency, balance],
        );

        const openingId = randomUUID();
        const openingKey = `opening:${walletId}`;
        const openingExternalId = `opening-external:${walletId}`;

        await client.query(
          `INSERT INTO "${schemaName}".wager_transactions
            (
              id,
              provider_id,
              player_id,
              wallet_id,
              external_transaction_id,
              idempotency_key,
              payload_hash,
              type,
              status,
              amount,
              currency,
              failure_code
            )
           VALUES ($1, 'system', $2, $3, $4, $5, $6, 'OPENING',
                   'PROCESSED', $7, $8, NULL)`,
          [
            openingId,
            playerId,
            walletId,
            openingExternalId,
            openingKey,
            "opening",
            balance,
            currency,
          ],
        );

        await client.query(
          `INSERT INTO "${schemaName}".wallet_ledger_entries
            (
              id,
              wallet_id,
              transaction_id,
              direction,
              amount,
              currency,
              balance_before,
              balance_after
            )
           VALUES ($1, $2, $3, 'CREDIT', $4, $5, '0.00', $4)`,
          [
            randomUUID(),
            walletId,
            openingId,
            balance,
            currency,
          ],
        );
      } finally {
        client.release();
      }
    };

    const wager = (
      overrides: Partial<{
        providerId: string;
        playerId: string;
        walletId: string;
        externalTransactionId: string;
        idempotencyKey: string;
        amount: string;
        currency: string;
      }> = {},
    ) => ({
      providerId: "provider-1",
      playerId: "player-1",
      walletId: "wallet-race",
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      amount: "80.00",
      currency: "BRL",
      ...overrides,
    });

    const readWallet = async (walletId: string) => {
      const result = await pool.query<{
        balance: string;
        version: number;
      }>(
        `SELECT balance::text AS balance, version
         FROM "${schemaName}".wallets
         WHERE id = $1`,
        [walletId],
      );

      return result.rows[0];
    };

    const readLedger = async (walletId: string) => {
      const result = await pool.query<{
        direction: string;
        amount: string;
      }>(
        `SELECT direction, amount::text AS amount
         FROM "${schemaName}".wallet_ledger_entries
         WHERE wallet_id = $1`,
        [walletId],
      );

      return result.rows;
    };

    const readTransactions = async (walletId: string) => {
      const result = await pool.query<{
        type: string;
        status: string;
        amount: string;
      }>(
        `SELECT type, status, amount::text AS amount
         FROM "${schemaName}".wager_transactions
         WHERE wallet_id = $1`,
        [walletId],
      );

      return result.rows;
    };

    beforeAll(async () => {
      pool = new Pool({
        host: process.env.POSTGRES_HOST ?? "localhost",
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.DB_NAME,
        max: 20,
      });

      schemaName = `wager_test_${randomUUID().replaceAll("-", "")}`;

      await pool.query(`CREATE SCHEMA "${schemaName}"`);

      await pool.query(`
        CREATE TABLE "${schemaName}".wallets (
          id TEXT PRIMARY KEY,
          player_id TEXT NOT NULL,
          currency CHAR(3) NOT NULL,
          balance NUMERIC(20, 2) NOT NULL,
          version INTEGER NOT NULL,
          CONSTRAINT wallet_balance_non_negative
            CHECK (balance >= 0),
          CONSTRAINT wallet_version_positive
            CHECK (version >= 1)
        )
      `);

      await pool.query(`
        CREATE TABLE "${schemaName}".wager_transactions (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          player_id TEXT NOT NULL,
          wallet_id TEXT NOT NULL
            REFERENCES "${schemaName}".wallets(id),
          external_transaction_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          round_id TEXT NULL,
          game_id TEXT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          amount NUMERIC(20, 2) NOT NULL,
          currency CHAR(3) NOT NULL,
          failure_code TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT wager_amount_positive
            CHECK (amount > 0)
        )
      `);

      await pool.query(`
        CREATE UNIQUE INDEX wager_provider_idempotency_unique
        ON "${schemaName}".wager_transactions
          (provider_id, idempotency_key)
      `);

      await pool.query(`
        CREATE UNIQUE INDEX wager_provider_external_unique
        ON "${schemaName}".wager_transactions
          (provider_id, external_transaction_id)
      `);

      await pool.query(`
        CREATE TABLE "${schemaName}".wallet_ledger_entries (
          id TEXT PRIMARY KEY,
          wallet_id TEXT NOT NULL
            REFERENCES "${schemaName}".wallets(id),
          transaction_id TEXT NOT NULL UNIQUE
            REFERENCES "${schemaName}".wager_transactions(id),
          direction TEXT NOT NULL,
          amount NUMERIC(20, 2) NOT NULL,
          currency CHAR(3) NOT NULL,
          balance_before NUMERIC(20, 2) NOT NULL,
          balance_after NUMERIC(20, 2) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT ledger_amount_positive
            CHECK (amount > 0),
          CONSTRAINT ledger_direction_valid
            CHECK (direction IN ('CREDIT', 'DEBIT'))
        )
      `);

      schema = {
        ...DEFAULT_PROCESS_WAGER_SCHEMA,
        wagerTransaction: {
          ...DEFAULT_PROCESS_WAGER_SCHEMA.wagerTransaction,
          type: "type",
        },
        tables: {
          wallets: `${schemaName}.wallets`,
          wagerTransactions: `${schemaName}.wager_transactions`,
          ledgerEntries: `${schemaName}.wallet_ledger_entries`,
        },
      };

      const provider = new SchemaScopedTransactionProvider(
        pool,
        schemaName,
      );

      manager = new PostgreSQLProcessWagerTransactionManager(
        provider,
        schema,
      );
    }, 30_000);

    beforeEach(async () => {
      await pool.query(`
        TRUNCATE TABLE
          "${schemaName}".wallet_ledger_entries,
          "${schemaName}".wager_transactions,
          "${schemaName}".wallets
        CASCADE
      `);
    });

    afterAll(async () => {
      if (pool) {
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        } finally {
          await pool.end();
        }
      }
    });

    it("processes only one of two simultaneous bets of 80 against a balance of 100", async () => {
      await createWallet("wallet-race", "100.00");

      const processWager = createUseCase();

      const results = await Promise.all([
        processWager.execute(
          wager({
            externalTransactionId: "external-race-1",
            idempotencyKey: "race-key-1",
          }),
        ),
        processWager.execute(
          wager({
            externalTransactionId: "external-race-2",
            idempotencyKey: "race-key-2",
          }),
        ),
      ]);

      expect(
        results.filter((result) => result.outcome === "PROCESSED"),
      ).toHaveLength(1);

      expect(
        results.filter((result) => result.outcome === "REJECTED"),
      ).toHaveLength(1);

      const currentWallet = await readWallet("wallet-race");

      expect(currentWallet?.balance).toBe("20.00");
      expect(currentWallet?.version).toBe(2);

      const ledger = await readLedger("wallet-race");
      const debitEntries = ledger.filter(
        (entry) => entry.direction === "DEBIT",
      );

      expect(ledger).toHaveLength(2);
      expect(debitEntries).toHaveLength(1);
      expect(debitEntries[0]?.amount).toBe("80.00");

      const transactions = await readTransactions("wallet-race");

      expect(
        transactions.filter(
          (transaction) =>
            transaction.type === "BET" &&
            transaction.status === "PROCESSED",
        ),
      ).toHaveLength(1);

      expect(
        transactions.filter(
          (transaction) =>
            transaction.type === "BET" &&
            transaction.status === "REJECTED",
        ),
      ).toHaveLength(1);
    }, 30_000);

    it("processes one transaction for 50 simultaneous requests with the same idempotency key", async () => {
      await createWallet("wallet-race", "100.00");

      const processWager = createUseCase();

      const command = wager({
        externalTransactionId: "external-replay",
        idempotencyKey: "same-idempotency-key",
        amount: "10.00",
      });

      const results = await Promise.all(
        Array.from(
          { length: 50 },
          () => processWager.execute(command),
        ),
      );

      expect(
        results.filter((result) => result.outcome === "PROCESSED"),
      ).toHaveLength(1);

      expect(
        results.filter((result) => result.outcome === "DUPLICATE"),
      ).toHaveLength(49);

      const transactionIds = new Set(
        results.map((result) => result.transaction.id),
      );

      expect(transactionIds.size).toBe(1);

      const currentWallet = await readWallet("wallet-race");

      expect(currentWallet?.balance).toBe("90.00");
      expect(currentWallet?.version).toBe(2);

      const ledger = await readLedger("wallet-race");

      expect(
        ledger.filter((entry) => entry.direction === "DEBIT"),
      ).toHaveLength(1);
    }, 30_000);

    it("returns conflict for simultaneous requests reusing one key with different payloads", async () => {
      await createWallet("wallet-race", "100.00");

      const processWager = createUseCase();

      const results = await Promise.all([
        processWager.execute(
          wager({
            externalTransactionId: "external-conflict-1",
            idempotencyKey: "same-key-conflict",
            amount: "10.00",
          }),
        ),
        processWager.execute(
          wager({
            externalTransactionId: "external-conflict-2",
            idempotencyKey: "same-key-conflict",
            amount: "20.00",
          }),
        ),
      ]);

      expect(
        results.filter((result) => result.outcome === "PROCESSED"),
      ).toHaveLength(1);

      expect(
        results.filter((result) => result.outcome === "CONFLICT"),
      ).toHaveLength(1);

      const processed = results.find(
        (result) => result.outcome === "PROCESSED",
      );

      const currentWallet = await readWallet("wallet-race");

      expect(currentWallet?.version).toBe(2);

      const expectedBalance =
        processed?.transaction.amount.amount === "10.00"
          ? "90.00"
          : "80.00";

      expect(currentWallet?.balance).toBe(expectedBalance);

      const ledger = await readLedger("wallet-race");

      expect(
        ledger.filter((entry) => entry.direction === "DEBIT"),
      ).toHaveLength(1);
    }, 30_000);

    it("returns conflict for simultaneous requests reusing one external transaction ID", async () => {
      await createWallet("wallet-race", "100.00");

      const processWager = createUseCase();

      const results = await Promise.all([
        processWager.execute(
          wager({
            externalTransactionId: "same-external-id",
            idempotencyKey: "different-key-1",
            amount: "10.00",
          }),
        ),
        processWager.execute(
          wager({
            externalTransactionId: "same-external-id",
            idempotencyKey: "different-key-2",
            amount: "20.00",
          }),
        ),
      ]);

      expect(
        results.filter((result) => result.outcome === "PROCESSED"),
      ).toHaveLength(1);

      expect(
        results.filter((result) => result.outcome === "CONFLICT"),
      ).toHaveLength(1);

      const currentWallet = await readWallet("wallet-race");

      expect(currentWallet?.version).toBe(2);

      const ledger = await readLedger("wallet-race");

      expect(
        ledger.filter((entry) => entry.direction === "DEBIT"),
      ).toHaveLength(1);
    }, 30_000);

    it("does not debit a wallet when the bet is rejected", async () => {
      await createWallet("wallet-race", "10.00");

      const processWager = createUseCase();

      const result = await processWager.execute(
        wager({
          externalTransactionId: "external-insufficient",
          idempotencyKey: "key-insufficient",
          amount: "80.00",
        }),
      );

      expect(result.outcome).toBe("REJECTED");

      const currentWallet = await readWallet("wallet-race");

      expect(currentWallet?.balance).toBe("10.00");
      expect(currentWallet?.version).toBe(1);

      const ledger = await readLedger("wallet-race");

      expect(
        ledger.filter((entry) => entry.direction === "DEBIT"),
      ).toHaveLength(0);
    }, 30_000);

    it("does not share idempotency identities between providers", async () => {
      await createWallet("wallet-race", "100.00");

      const processWager = createUseCase();

      const first = await processWager.execute(
        wager({
          providerId: "provider-1",
          externalTransactionId: "external-provider-1",
          idempotencyKey: "shared-key",
          amount: "10.00",
        }),
      );

      const second = await processWager.execute(
        wager({
          providerId: "provider-2",
          externalTransactionId: "external-provider-2",
          idempotencyKey: "shared-key",
          amount: "10.00",
        }),
      );

      expect(first.outcome).toBe("PROCESSED");
      expect(second.outcome).toBe("PROCESSED");

      const currentWallet = await readWallet("wallet-race");

      expect(currentWallet?.balance).toBe("80.00");
      expect(currentWallet?.version).toBe(3);
    }, 30_000);
  },
);