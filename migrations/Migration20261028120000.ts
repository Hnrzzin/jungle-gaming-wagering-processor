import { Migration } from "@mikro-orm/migrations";

export class Migration20261028120000 extends Migration {
  async up(): Promise<void> {
  this.addSql(`
    create table wallets (
      id UUID NOT NULL PRIMARY KEY,
      player_id UUID NOT NULL,
      currency VARCHAR(3) NOT NULL,
      balance NUMERIC(19,2) NOT NULL,
      version INT NOT NULL,
      created_at NOT NULL TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at NOT NULL TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT wallets_player_currency_key UNIQUE (player_id, currency),
      CONSTRAINT wallets_balance_check CHECK (balance >= 0)
    );
  `);
}

  override async down(): Promise<void> {
    this.addSql(`drop table wallets;`);
  }
}

