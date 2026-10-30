import { Migration } from "@mikro-orm/migrations";

export class Migration20261030120000 extends Migration {
  override async up(): Promise<void> {
    // Keep the established "wagering_transactions.kind" contract used by
    // the domain repositories and the BET processor.
    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
    `);

    // The previous migration protects ledger rows with an immutable trigger.
    // Temporarily disable that trigger for this one-time metadata backfill.
    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        DISABLE TRIGGER wallet_ledger_entries_no_update_delete;
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
        ENABLE TRIGGER wallet_ledger_entries_no_update_delete;
    `);

    // Older domain repositories omit currency in ledger INSERT statements.
    // Derive it from the wallet, while the newer processor may supply it.
    this.addSql(`
      CREATE OR REPLACE FUNCTION wallet_ledger_entries_fill_currency()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.currency IS NULL THEN
          SELECT currency
          INTO NEW.currency
          FROM wallets
          WHERE id = NEW.wallet_id;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    this.addSql(`
      DROP TRIGGER IF EXISTS wallet_ledger_entries_set_currency
      ON wallet_ledger_entries;
    `);

    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_set_currency
      BEFORE INSERT ON wallet_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION wallet_ledger_entries_fill_currency();
    `);

    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        ALTER COLUMN currency SET NOT NULL,
        ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
    `);

    this.addSql(`
      ALTER TABLE wagering_transactions
        ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS wallet_ledger_entries_set_currency
      ON wallet_ledger_entries;
    `);

    this.addSql(`
      DROP FUNCTION IF EXISTS wallet_ledger_entries_fill_currency();
    `);

    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        ALTER COLUMN created_at DROP DEFAULT;
    `);

    this.addSql(`
      ALTER TABLE wagering_transactions
        ALTER COLUMN created_at DROP DEFAULT;
    `);

    this.addSql(`
      ALTER TABLE wallet_ledger_entries
        DROP COLUMN IF EXISTS currency;
    `);
  }
}
