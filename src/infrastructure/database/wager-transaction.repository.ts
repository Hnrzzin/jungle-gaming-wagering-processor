
import { EntityManager } from "@mikro-orm/postgresql";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type WagerTransactionState,
} from "../../domain/wager-transaction";
import { Money } from "../../domain/money";

export class WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(transaction: WagerTransaction): Promise<void> {
    const sql = `
      INSERT INTO wagering_transactions (
        id,
        provider_id,
        external_transaction_id,
        idempotency_key,
        payload_hash,
        wallet_id,
        player_id,
        round_id,
        game_id,
        kind,
        status,
        amount,
        currency,
        created_at,
        processed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.em.execute(sql, [
      transaction.id,
      transaction.providerId,
      transaction.externalTransactionId,
      transaction.idempotencyKey,
      transaction.payloadHash,
      transaction.walletId,
      transaction.playerId,
      transaction.roundId,
      transaction.gameId,
      transaction.kind,
      transaction.status,
      transaction.money.toString(),
      transaction.money.currency,
      transaction.createdAt,
      transaction.processedAt ?? null,
    ]);
  }

   async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const sql = `
      SELECT *
      FROM wagering_transactions
      WHERE provider_id = ? AND idempotency_key = ?
    `;

    const rows = await this.em.execute(sql, [providerId, idempotencyKey]);

    if (!rows || rows.length === 0) {
      return null;
    }

    return this.toDomain(rows[0] as WagerTransaction);
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const sql = `
      SELECT *
      FROM wagering_transactions
      WHERE provider_id = ? AND external_transaction_id = ?
    `;

    const rows = await this.em.execute(sql, [
      providerId,
      externalTransactionId,
    ]);

    if (!rows || rows.length === 0) {
      return null;
    }

    return this.toDomain(rows[0] as WagerTransaction);
  }

  private toDomain(row: Record<string, any>): WagerTransaction {
    const state: WagerTransactionState = {
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind as WagerTransactionKind,
      money: Money.from({
        amount: String(row.amount),
        currency: row.currency,
      }),
      createdAt: new Date(row.created_at),
      status: row.status as WagerTransactionStatus,
      processedAt: row.processed_at
        ? new Date(row.processed_at)
        : undefined,
    };

    return WagerTransaction.rehydrate(state);
  }
}
