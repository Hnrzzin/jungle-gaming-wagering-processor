import { EntityManager } from "@mikro-orm/postgresql";
import { Wallet } from "../../domain/wallet";
import { Money } from "../../domain/money";

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
    const rows = await this.em.execute(`SELECT * FROM wallets WHERE id = ?`, [id]);
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.toDomain(rows[0] as Record<string, any>);
  }

  // SELECT ... FOR UPDATE: trava a linha até o fim da transação atual.
  // Use com o EntityManager da transação (tx), nunca com orm.em.
  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const rows = await this.em.execute(`SELECT * FROM wallets WHERE id = ? FOR UPDATE`, [id]);
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.toDomain(rows[0] as Record<string, any>);
  }

  private toDomain(row: Record<string, any>): Wallet {
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: Money.from({ amount: String(row.balance), currency: row.currency }),
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}