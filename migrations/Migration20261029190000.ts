import { Migration } from "@mikro-orm/migrations";

export class Migration20261029190000 extends Migration {
  async up(): Promise<void> {
    // Corrige eventuais registros antigos antes de exigir NOT NULL.
    this.addSql(`
      UPDATE wallets
      SET
        created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
        updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE created_at IS NULL OR updated_at IS NULL;
    `);

    // Garante que toda carteira tenha as duas datas.
    this.addSql(`
      ALTER TABLE wallets
        ALTER COLUMN created_at SET NOT NULL,
        ALTER COLUMN updated_at SET NOT NULL;
    `);
  }

  override async down(): Promise<void> {
    // Reverte apenas a obrigatoriedade, preservando os valores e defaults.
    this.addSql(`
      ALTER TABLE wallets
        ALTER COLUMN created_at DROP NOT NULL,
        ALTER COLUMN updated_at DROP NOT NULL;
    `);
  }
}