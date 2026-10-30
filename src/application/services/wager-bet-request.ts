import type { ProcessWagerCommand } from "../use-cases/process-wager";
import {
  InvalidIdempotencyKeyError,
  validateIdempotencyKey,
} from "./validate-idempotency-key";

export interface WagerBetRequestBody {
  readonly providerId: unknown;
  readonly playerId: unknown;
  readonly walletId: unknown;
  readonly externalTransactionId: unknown;
  readonly amount: unknown;
  readonly currency: unknown;
  readonly roundId?: unknown;
  readonly gameId?: unknown;
}

export class InvalidWagerBetRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWagerBetRequestError";
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidWagerBetRequestError(`${field} is required`);
  }

  return value;
}

export function parseWagerBetRequest(
  body: WagerBetRequestBody,
  idempotencyKeyHeader: string | undefined,
 ): ProcessWagerCommand {
  if (typeof body !== "object" || body === null) {
    throw new InvalidWagerBetRequestError("request body must be a JSON object");
  }

  let idempotencyKey: string;

  try {
    idempotencyKey = validateIdempotencyKey(idempotencyKeyHeader);
  } catch (error) {
    if (error instanceof InvalidIdempotencyKeyError) {
      throw new InvalidWagerBetRequestError(error.message);
    }

    throw error;
  }

  const providerId = requireString(body.providerId, "providerId");
  const playerId = requireString(body.playerId, "playerId");
  const walletId = requireString(body.walletId, "walletId");
  const externalTransactionId = requireString(
    body.externalTransactionId,
    "externalTransactionId",
  );
  const amount = requireString(body.amount, "amount");
  const currency = requireString(body.currency, "currency");

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidWagerBetRequestError(
      "currency must be an ISO 4217 uppercase code",
    );
  }

  if (!/^\d{1,17}\.\d{2}$/.test(amount)) {
    throw new InvalidWagerBetRequestError(
      "amount must use the decimal format 0.00",
    );
  }

  const roundId = body.roundId === undefined ? undefined : requireString(body.roundId, "roundId");
  const gameId = body.gameId === undefined ? undefined : requireString(body.gameId, "gameId");

  if (roundId !== undefined && roundId.length > 128) {
    throw new InvalidWagerBetRequestError("roundId exceeds 128 characters");
  }
  if (gameId !== undefined && gameId.length > 128) {
    throw new InvalidWagerBetRequestError("gameId exceeds 128 characters");
  }

  return {
    providerId,
    playerId,
    walletId,
    externalTransactionId,
    idempotencyKey,
    amount,
    currency,
    ...(roundId === undefined ? {} : { roundId }),
    ...(gameId === undefined ? {} : { gameId }),
  };
}