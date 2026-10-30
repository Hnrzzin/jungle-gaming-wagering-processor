import { Migration } from "@mikro-orm/migrations";

export class Migration20261028150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table wallets alter column id drop default;
    `);

    this.addSql(`
      CREATE table wagering_transactions (
        id UUID PRIMARY KEY,
        provider_id VARCHAR(64) NOT NULL,
        external_transaction_id VARCHAR(128) NOT NULL,
        idempotency_KEY VARCHAR(256) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        wallet_id UUID NOT NULL,
        player_id VARCHAR(128) NOT NULL,
        round_id VARCHAR(128) NOT NULL,
        game_id VARCHAR(128) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        status VARCHAR(32) NOT NULL,
        amount NUMERIC(19,2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,

        CONSTRAINT wagering_transactions_provider_idempotency_key
          UNIQUE (provider_id, idempotency_key),
        CONSTRAINT wagering_transactions_provider_external_key
          UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wagering_transactions_wallet_fk
          FOREIGN KEY (wallet_id) REFERENCES wallets (id)
      );
    `);

    this.addSql(`
      CREATE table wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL,
        transaction_id UUID NOT NULL,
        direction VARCHAR(6) NOT NULL,
        amount NUMERIC(19,2) NOT NULL,
        balance_before NUMERIC(19,2) NOT NULL,
        balance_after NUMERIC(19,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,

        CONSTRAINT wallet_ledger_entries_wallet_fk
          FOREIGN KEY (wallet_id) REFERENCES wallets (id),
        CONSTRAINT wallet_ledger_entries_transaction_fk
          FOREIGN KEY (transaction_id) REFERENCES wagering_transactions (id),
        CONSTRAINT wallet_ledger_entries_direction_check
          CHECK (direction in ('DEBIT', 'CREDIT')),
        CONSTRAINT wallet_ledger_entries_amount_check
          CHECK (amount > 0),
        CONSTRAINT wallet_ledger_entries_arithmetic_check
          CHECK (
            case
              WHEN direction = 'DEBIT'  THEN balance_before - amount = balance_after
              WHEN direction = 'CREDIT' THEN balance_before + amount = balance_after
              else null
            end
          ),
        CONSTRAINT wallet_ledger_entries_wallet_transaction_key
          UNIQUE (wallet_id, transaction_id)
      );
    `);

    this.addSql(`
      CREATE OR REPLACE function wallet_ledger_entries_immutable()
      returns TRIGGER as $$
      begin
        RAISE EXCEPTION 'wallet_ledger_entries is immutable';
      END;
      $$ language plpgsql;
    `);

    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_no_update_delete
        BEFORE UPDATE or DELETE on wallet_ledger_entries
        FOR EACH row execute function wallet_ledger_entries_immutable();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop TRIGGER if exists wallet_ledger_entries_no_update_delete on wallet_ledger_entries;`);
    this.addSql(`drop function if exists wallet_ledger_entries_immutable();`);
    this.addSql(`drop table if exists wallet_ledger_entries;`);
    this.addSql(`drop table if exists wagering_transactions;`);
    this.addSql(`alter table wallets alter column id set default gen_random_UUID();`);
  }
}