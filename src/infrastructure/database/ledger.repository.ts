import { EntityManager } from "@mikro-orm/postgresql";
import { WalletLedgerEntry, LedgerDirection } from "../../domain/wallet-ledger-entry";
import { Money } from "../../domain/money";

export class LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async append(entry: WalletLedgerEntry): Promise<void> {
    const sql = `
      INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, balance_before, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await this.em.execute(sql, [
      entry.id,
      entry.walletId,
      entry.transactionId,
      entry.direction,
      entry.money.toString(), // Converte o objeto Money para string ("100.00")
      entry.balanceBefore.toString(),
      entry.balanceAfter.toString(),
      entry.createdAt
    ]);
  }

  // O extrato retorna uma lista (Array) de lançamentos
  async findByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    // Busca pela carteira e ordena do mais antigo para o mais novo
    const sql = `SELECT * FROM wallet_ledger_entries WHERE wallet_id = ? ORDER BY created_at ASC, id ASC`;
    const rows = await this.em.execute(sql, [walletId]);

    // Transforma as linhas do banco (rows) em instâncias de WalletLedgerEntry
    return rows.map((row: Record<string, any>) => {
      return WalletLedgerEntry.rehydrate({
        id: row.id,
        walletId: row.wallet_id, // snake_case vindo do banco
        transactionId: row.transaction_id,
        direction: row.direction as LedgerDirection, 
        money: Money.from({ amount: String(row.amount), currency: 'BRL' }),
        balanceBefore: Money.from({ amount: String(row.balance_before), currency: 'BRL' }),
        balanceAfter: Money.from({ amount: String(row.balance_after), currency: 'BRL' }),
        createdAt: new Date(row.created_at)
      });
    });
  }
}