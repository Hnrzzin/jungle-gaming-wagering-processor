import { randomUUIDv7 } from "bun";
import { createHash } from "node:crypto";
import { EntityManager } from "@mikro-orm/postgresql";

import { Money } from "../../domain/money";
import { Wallet } from "../../domain/wallet";
import {
  WagerTransaction,
  WagerTransactionKind,
} from "../../domain/wager-transaction";
import {
  LedgerDirection,
  WalletLedgerEntry,
} from "../../domain/wallet-ledger-entry";

import { WalletRepository } from "../../infrastructure/database/wallet.repository";
import { LedgerRepository } from "../../infrastructure/database/ledger.repository";
import { WagerTransactionRepository } from "../../infrastructure/database/wager-transaction.repository";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: Money;
}

export class CreateWallet {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput): Promise<Wallet> {
    // Toda a operação acontece em uma única transação PostgreSQL.
    return this.em.transactional(async (tx) => {
      const now = new Date();

      // 1. Cria a carteira já com o saldo inicial.
      const wallet = Wallet.open({
        id: randomUUIDv7(),
        playerId: input.playerId,
        initialBalance: input.initialBalance,
      });

      const walletRepository = new WalletRepository(tx);
      const transactionRepository = new WagerTransactionRepository(tx);
      const ledgerRepository = new LedgerRepository(tx);

      // 2. Persiste a carteira.
      await walletRepository.insert(wallet);

      // Saldo zero não exige transação OPENING nem lançamento no ledger.
      if (input.initialBalance.isZero()) {
        return wallet;
      }

      // 3. Gera identificadores internos exclusivos para a abertura.
      const transactionId = randomUUIDv7();
      const openingKey = `opening:${wallet.id}`;

      // O hash representa os dados relevantes da operação de abertura.
      const payloadHash = createHash("sha256")
        .update(
          JSON.stringify({
            walletId: wallet.id,
            playerId: wallet.playerId,
            kind: WagerTransactionKind.Opening,
            amount: input.initialBalance.toString(),
            currency: input.initialBalance.currency,
          }),
        )
        .digest("hex");

      // 4. Cria a transação interna já concluída.
      const openingTransaction = WagerTransaction.createOpening({
        id: transactionId,
        providerId: "system",
        externalTransactionId: openingKey,
        idempotencyKey: openingKey,
        payloadHash,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: "opening",
        gameId: "opening",
        kind: WagerTransactionKind.Opening,
        money: input.initialBalance,
        createdAt: now,
      });

      await transactionRepository.insert(openingTransaction);

      // 5. Registra contabilmente o saldo inicial.
      // A carteira já nasceu com esse saldo: não devemos creditá-la novamente.
      const openingEntry = WalletLedgerEntry.create({
        id: randomUUIDv7(),
        walletId: wallet.id,
        transactionId: transactionId,
        createdAt: now,
        direction: LedgerDirection.Credit,
        money: input.initialBalance,
        balanceBefore: Money.zero(input.initialBalance.currency),
        balanceAfter: input.initialBalance,
      });

      await ledgerRepository.append(openingEntry);

      return wallet;
    });
  }
}
