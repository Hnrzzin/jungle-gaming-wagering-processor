import { EntityManager } from '@mikro-orm/postgresql';
import { Wallet } from "../../domain/wallet";
import { Money } from '../../domain/money';
// Qualquer coisa que saiba rodar SQL com "?" (o em do MikroORM serve)
export interface SqlExecutor {
  execute(query: string, params?: unknown[]): Promise<any>;
}

export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(wallet: Wallet): Promise<void> {
    const sql = `
      INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await this.em.execute(sql, [
      wallet.id,
      wallet.playerId,
      wallet.currency,
      wallet.balance.toString(),
      wallet.version,
      wallet.createdAt,
      wallet.updatedAt,
    ]);
  }

  async findById(id: string): Promise<Wallet | null> {
    const sql = `SELECT * FROM wallets WHERE id = ?`;
    const rows = await this.em.execute(sql, [id]); // sem getConnection() pra manter a atomicidade

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0] as Record<string, any>;

    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: Money.from({amount: String(row.balance), currency: row.currency}),
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}

