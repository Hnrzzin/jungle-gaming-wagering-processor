import { Migration } from "@mikro-orm/migrations";

export class Migration20261030120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "wager_transactions_provider_idempotency_unique"
      ON "wager_transactions"
        ("provider_id", "idempotency_key");
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "wager_transactions_provider_external_unique"
      ON "wager_transactions"
        ("provider_id", "external_transaction_id");
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "wallet_ledger_entries_wallet_transaction_unique"
      ON "wallet_ledger_entries"
        ("wallet_id", "transaction_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS
        "wallet_ledger_entries_wallet_transaction_unique";
    `);

    this.addSql(`
      DROP INDEX IF EXISTS
        "wager_transactions_provider_external_unique";
    `);

    this.addSql(`
      DROP INDEX IF EXISTS
        "wager_transactions_provider_idempotency_unique";
    `);
  }
}