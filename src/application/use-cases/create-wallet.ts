
import { createHash, randomUUID } from "node:crypto";
import { EntityManager } from "@mikro-orm/postgresql";

import { Money } from "../../domain/money";
import {
  WagerTransaction,
  WagerTransactionKind,
} from "../../domain/wager-transaction";
import { LedgerDirection, WalletLedgerEntry } from "../../domain/wallet-ledger-entry";
import { Wallet } from "../../domain/wallet";

import { WalletRepository } from "../../infrastructure/database/wallet.repository";
import { WagerTransactionRepository } from "../../infrastructure/database/wager-transaction.repository";
import { LedgerRepository } from "../../infrastructure/database/ledger.repository";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: Money;
}

export class CreateWallet {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput): Promise<Wallet> {
    const walletId = randomUUID();
    const now = new Date();

    const wallet = Wallet.open({
      id: walletId,
      playerId: input.playerId,
      initialBalance: input.initialBalance,
    });

    await this.em.transactional(async (txEm) => {
      const walletRepository = new WalletRepository(txEm);
      const transactionRepository = new WagerTransactionRepository(txEm);
      const ledgerRepository = new LedgerRepository(txEm);

      await walletRepository.insert(wallet);

      // Saldo zero não exige transação OPENING nem lançamento.
      if (input.initialBalance.isZero()) {
        return;
      }

      const openingId = randomUUID();

      const openingPayload = JSON.stringify({
        walletId,
        playerId: input.playerId,
        amount: input.initialBalance.toString(),
        currency: input.initialBalance.currency,
        kind: WagerTransactionKind.Opening,
      });

      const payloadHash = createHash("sha256")
        .update(openingPayload)
        .digest("hex");

      const openingTransaction = WagerTransaction.createOpening({
        id: openingId,
        providerId: "internal",
        externalTransactionId: openingId,
        idempotencyKey: `opening:${walletId}`,
        payloadHash,
        walletId,
        playerId: input.playerId,
        roundId: "internal",
        gameId: "internal",
        kind: WagerTransactionKind.Opening,
        money: input.initialBalance,
        createdAt: now,
      });

      await transactionRepository.insert(openingTransaction);

      // A carteira já nasce com o saldo inicial.
      // Portanto, apenas registramos o crédito no ledger.
      const ledgerEntry = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId,
        transactionId: openingId,
        direction: LedgerDirection.Credit,
        money: input.initialBalance,
        balanceBefore: Money.zero(input.initialBalance.currency),
        balanceAfter: input.initialBalance,
        createdAt: now,
      });

      await ledgerRepository.append(ledgerEntry);
    });

    return wallet;
  }
}

export interface ClassifyWagerRequest {
  providerId: string;
  idempotencyKey: string;
  externalTransactionId: string;
  payloadHash: string;
}

export interface WagerTransactionLookupRepository {
  findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;

  findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
}

export type WagerRequestClassification =
  | { outcome: "NEW"; transaction: null }
  | { outcome: "DUPLICATE"; transaction: WagerTransaction }
  | { outcome: "CONFLICT"; transaction: WagerTransaction | null };

export async function classifyWagerRequest(
  repository: WagerTransactionLookupRepository,
  request: ClassifyWagerRequest,
): Promise<WagerRequestClassification> {
  const [byKey, byExternal] = await Promise.all([
    repository.findByIdempotencyKey(
      request.providerId,
      request.idempotencyKey,
    ),
    repository.findByExternalTransactionId(
      request.providerId,
      request.externalTransactionId,
    ),
  ]);

  // Nenhum identificador foi encontrado: é uma nova requisição.
  if (!byKey && !byExternal) {
    return {
      outcome: "NEW",
      transaction: null,
    };
  }

  // Apenas um identificador encontrado: os dados divergem.
  if (!byKey || !byExternal) {
    return {
      outcome: "CONFLICT",
      transaction: byKey ?? byExternal,
    };
  }

  // Os identificadores apontam para transações diferentes.
  if (byKey.id !== byExternal.id) {
    return {
      outcome: "CONFLICT",
      transaction: null,
    };
  }

  // Mesmo registro, mas conteúdo diferente.
  if (!byKey.matchesPayload(request.payloadHash)) {
    return {
      outcome: "CONFLICT",
      transaction: byKey,
    };
  }

  // Mesmo registro e mesmo payload: duplicata legítima.
  return {
    outcome: "DUPLICATE",
    transaction: byKey,
  };
}
