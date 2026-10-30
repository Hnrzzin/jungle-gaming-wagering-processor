import type { WagerTransaction } from "../../domain/wager-transaction";

export type WagerOutcome = "NEW" | "DUPLICATE" | "CONFLICT";

export interface ClassificationResult {
  outcome: WagerOutcome;
  transaction?: WagerTransaction;
}

export interface WagerRequest {
  providerId: string;
  idempotencyKey: string;
  externalTransactionId: string;
  payloadHash: string;
}

export interface WagerTransactionLookup {
  findByIdempotencyKey(providerId: string, idempotencyKey: string): Promise<WagerTransaction | null>;
  findByExternalTransactionId(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null>;
}

export async function classifyWagerRequest(
  repo: WagerTransactionLookup,
  request: WagerRequest,
): Promise<ClassificationResult> {
  const byKey = await repo.findByIdempotencyKey(request.providerId, request.idempotencyKey);
  const byExternal = await repo.findByExternalTransactionId(request.providerId, request.externalTransactionId);

  // nada encontrado: a requisição é nova
  if (!byKey && !byExternal) {
    return { outcome: "NEW" };
  }

  // um dos identificadores não encontrou nada, ou os dois apontam para registros diferentes
  if (!byKey || !byExternal || byKey.id !== byExternal.id) {
    return { outcome: "CONFLICT" };
  }

  // mesmo registro pelos dois identificadores: só é duplicata se o payload também for igual
  if (!byKey.matchesPayload(request.payloadHash)) {
    return { outcome: "CONFLICT" };
  }

  return { outcome: "DUPLICATE", transaction: byKey };
}