import type {
  ProcessWagerResult,
  WagerRecord,
} from "../use-cases/process-wager";

export interface WagerHttpTransaction {
  readonly id: string;
  readonly providerId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId?: string;
  readonly gameId?: string;
  readonly externalTransactionId: string;
  readonly type: string;
  readonly status: string;
  readonly amount: string;
  readonly currency: string;
  readonly failureCode: string | null;
}

export interface WagerHttpResult {
  readonly outcome: ProcessWagerResult["outcome"];
  readonly replayed: boolean;
  readonly transaction: WagerHttpTransaction;
}

function mapTransaction(
  transaction: WagerRecord,
): WagerHttpTransaction {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    playerId: transaction.playerId,
    walletId: transaction.walletId,
    ...(transaction.roundId === undefined ? {} : { roundId: transaction.roundId }),
    ...(transaction.gameId === undefined ? {} : { gameId: transaction.gameId }),
    externalTransactionId: transaction.externalTransactionId,
    type: transaction.type,
    status: transaction.status,
    amount: transaction.amount.amount,
    currency: transaction.amount.currency,
    failureCode: transaction.failureCode,
  };
}

export function mapWagerResult(
  result: ProcessWagerResult,
): WagerHttpResult {
  return {
    outcome: result.outcome,
    replayed: result.replayed,
    transaction: mapTransaction(result.transaction),
  };
}