import { Migration } from "@mikro-orm/migrations";

export class Migration20261030120000 extends Migration {
  override async up(): Promise<void> {
    // Align the persisted schema with PostgreSQLProcessWagerUnitOfWork.
    // The original migration created "wagering_transactions" with a "kind"
    // column, while the application reads/writes "wager_transactions.type".
    this.addSql(`
      DO $$
      BEGIN
        IF to_regclass(current_schema() || '.wager_transactions') IS NULL
          AND to_regclass(current_schema() || '.wagering_transactions') IS NOT NULL
        THEN
          EXECUTE format(
            'ALTER TABLE %I.%I RENAME TO %I',
            current_schema(),
            'wagering_transactions',
            'wager_transactions'
          );
        END IF;
      END
      $$;
    `);

    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'wager_transactions'
            AND column_name = 'kind'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'wager_transactions'
            AND column_name = 'type'
        ) THEN
          ALTER TABLE wager_transactions RENAME COLUMN kind TO type;
        END IF;
      END
      $$;
    `);

    // The application writes currency and relies on database defaults for
    // timestamps, so these columns must match its INSERT statements.
    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
    `);

    this.addSql(`
      UPDATE wallet_ledger_entries AS ledger
      SET currency = wallets.currency
      FROM wallets
      WHERE ledger.wallet_id = wallets.id
        AND ledger.currency IS NULL;
    `);

    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        ALTER COLUMN currency SET NOT NULL,
        ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
    `);

    this.addSql(`
      ALTER TABLE wager_transactions
        ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
    `);

    // Preserve the original unique constraints. They are already the
    // authoritative uniqueness guarantees for provider-scoped identities.
  }

  override async down(): Promise<void> {
    // This is a compatibility migration. Reversing it would make the
    // currently deployed application incompatible with the database.
    throw new Error(
      "Migration20261030120000 is intentionally irreversible; restore from backup instead.",
    );
  }
}
