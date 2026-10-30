import { sha256CanonicalJson } from "./canonical-json";

export interface WagerBusinessPayload {
  readonly providerId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly externalTransactionId: string;
  readonly type: "BET";
  readonly amount: string;
  readonly currency: string;
  readonly roundId?: string;
  readonly gameId?: string;
}

export function createWagerPayloadHash(
  payload: WagerBusinessPayload,
): string {
  return sha256CanonicalJson({
    providerId: payload.providerId,
    playerId: payload.playerId,
    walletId: payload.walletId,
    externalTransactionId: payload.externalTransactionId,
    type: payload.type,
    amount: payload.amount,
    currency: payload.currency,
    ...(payload.roundId === undefined ? {} : { roundId: payload.roundId }),
    ...(payload.gameId === undefined ? {} : { gameId: payload.gameId }),
  });
}