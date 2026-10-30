import { Migration } from "@mikro-orm/migrations";

export class Migration20261029210000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE wagering_transactions
        ADD COLUMN failure_code VARCHAR(64) NULL;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE wagering_transactions DROP COLUMN failure_code;`);
  }
}