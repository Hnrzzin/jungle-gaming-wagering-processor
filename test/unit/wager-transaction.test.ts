import { describe, expect, test } from "bun:test";
import { InvalidTransactionError, InvalidTransactionStateError } from "../../src/domain/errors";
import { FailureCode } from "../../src/domain/failure-code";
import { Money } from "../../src/domain/money";
import { LedgerDirection } from "../../src/domain/wallet-ledger-entry";
import {
  WagerTransaction,
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
} from "../../src/domain/wager-transaction";

type Props = Parameters<typeof WagerTransaction.create>[0];

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00Z");

const baseProps: Props = {
  id: "t1",
  providerId: "provider-a",
  externalTransactionId: "ext-1",
  idempotencyKey: "provider-a:ext-1",
  payloadHash: "hash-1",
  walletId: "w1",
  playerId: "p1",
  roundId: "r1",
  gameId: "g1",
  kind: Kind.Bet,
  money: brl("25.00"),
  createdAt: at,
};

const make = (overrides: Partial<Props> = {}) =>
  WagerTransaction.create({ ...baseProps, ...overrides });

const needsRef = (kind: Kind) => kind === Kind.Refund || kind === Kind.Rollback;

// cria uma transação do tipo pedido, já com referência quando o tipo exige
const makeKind = (kind: Kind, overrides: Partial<Props> = {}) =>
  make({
    ...(needsRef(kind) ? { referenceExternalTransactionId: "ext-0" } : {}),
    ...overrides,
    kind,
  });

describe("WagerTransaction.create", () => {
  test("nasce PENDING, sem falha, sem data de processamento e sem referência resolvida", () => {
    const t = make();
    expect(t.status).toBe(Status.Pending);
    expect(t.failureCode).toBeUndefined();
    expect(t.processedAt).toBeUndefined();
    expect(t.referenceTransactionId).toBeUndefined();
    expect(t.isTerminal()).toBe(false);
  });

  test("OPENING é interno e não pode ser criado por aqui", () => {
    expect(() => make({ kind: Kind.Opening })).toThrow(InvalidTransactionError);
  });

  test.each([Kind.Refund, Kind.Rollback])("%s exige referenceExternalTransactionId", (kind) => {
    expect(() => make({ kind })).toThrow(InvalidTransactionError);
  });

  test("REFUND com referência guarda o id externo da referência", () => {
    const t = makeKind(Kind.Refund);
    expect(t.referenceExternalTransactionId).toBe("ext-0");
  });

  test.each([Kind.Bet, Kind.Win, Kind.Loss])("%s não exige referência", (kind) => {
    expect(() => make({ kind })).not.toThrow();
  });
});

describe("consultas de domínio", () => {
  const requiresReferenceCases: [Kind, boolean][] = [
    [Kind.Bet, false],
    [Kind.Win, false],
    [Kind.Loss, false],
    [Kind.Refund, true],
    [Kind.Rollback, true],
  ];
  test.each(requiresReferenceCases)("requiresReference de %s é %p", (kind, expected) => {
    expect(makeKind(kind).requiresReference()).toBe(expected);
  });

  const affectsBalanceCases: [Kind, boolean][] = [
    [Kind.Bet, true],
    [Kind.Win, true],
    [Kind.Loss, false],
    [Kind.Refund, true],
    [Kind.Rollback, true],
  ];
  test.each(affectsBalanceCases)("affectsBalance de %s é %p", (kind, expected) => {
    expect(makeKind(kind).affectsBalance()).toBe(expected);
  });

  test("matchesPayload compara o hash", () => {
    const t = make();
    expect(t.matchesPayload("hash-1")).toBe(true);
    expect(t.matchesPayload("outro-hash")).toBe(false);
  });
});

describe("transições de estado", () => {
  test("PENDING -> PROCESSED guarda a data e a referência resolvida", () => {
    const t = makeKind(Kind.Refund);
    t.markProcessed("t0", at);
    expect(t.status).toBe(Status.Processed);
    expect(t.processedAt).toEqual(at);
    expect(t.referenceTransactionId).toBe("t0");
    expect(t.isTerminal()).toBe(true);
  });

  test("BET processada não tem referência", () => {
    const t = make();
    t.markProcessed(undefined, at);
    expect(t.status).toBe(Status.Processed);
    expect(t.referenceTransactionId).toBeUndefined();
  });

  test("PENDING -> PENDING_REFERENCE não é terminal", () => {
    const t = makeKind(Kind.Rollback);
    t.markPendingReference();
    expect(t.status).toBe(Status.PendingReference);
    expect(t.isTerminal()).toBe(false);
  });

  test("PENDING_REFERENCE -> PROCESSED", () => {
    const t = makeKind(Kind.Rollback);
    t.markPendingReference();
    t.markProcessed("t0", at);
    expect(t.status).toBe(Status.Processed);
  });

  test("PENDING_REFERENCE -> REJECTED quando a referência nunca aparece", () => {
    const t = makeKind(Kind.Rollback);
    t.markPendingReference();
    t.reject(FailureCode.ReferenceNotFound);
    expect(t.status).toBe(Status.Rejected);
    expect(t.failureCode).toBe(FailureCode.ReferenceNotFound);
  });

  test("PENDING -> REJECTED guarda o failureCode", () => {
    const t = make();
    t.reject(FailureCode.InsufficientBalance);
    expect(t.status).toBe(Status.Rejected);
    expect(t.failureCode).toBe(FailureCode.InsufficientBalance);
    expect(t.isTerminal()).toBe(true);
  });

  test("PENDING -> FAILED guarda o failureCode", () => {
    const t = make();
    t.fail(FailureCode.InternalError);
    expect(t.status).toBe(Status.Failed);
    expect(t.failureCode).toBe(FailureCode.InternalError);
    expect(t.isTerminal()).toBe(true);
  });

  test("PENDING_REFERENCE não vai de novo para PENDING_REFERENCE", () => {
    const t = makeKind(Kind.Rollback);
    t.markPendingReference();
    expect(() => t.markPendingReference()).toThrow(InvalidTransactionStateError);
  });
});

const terminalBuilders: Record<string, () => WagerTransaction> = {
  PROCESSED: () => {
    const t = make();
    t.markProcessed(undefined, at);
    return t;
  },
  REJECTED: () => {
    const t = make();
    t.reject(FailureCode.InsufficientBalance);
    return t;
  },
  FAILED: () => {
    const t = make();
    t.fail(FailureCode.InternalError);
    return t;
  },
};

for (const [name, build] of Object.entries(terminalBuilders)) {
  describe(`estado terminal ${name}`, () => {
    test("nenhuma transição é permitida e o status não muda", () => {
      const t = build();
      const statusBefore = t.status;

      expect(() => t.markProcessed(undefined, at)).toThrow(InvalidTransactionStateError);
      expect(() => t.markPendingReference()).toThrow(InvalidTransactionStateError);
      expect(() => t.reject(FailureCode.InsufficientBalance)).toThrow(InvalidTransactionStateError);
      expect(() => t.fail(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);

      expect(t.status).toBe(statusBefore);
    });
  });
}

describe("ledgerDirectionFor", () => {
  test("BET debita", () => {
    expect(make().ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  test("WIN credita", () => {
    expect(makeKind(Kind.Win).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  test("REFUND credita", () => {
    expect(makeKind(Kind.Refund).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  test("LOSS não movimenta saldo, então não tem direção", () => {
    expect(() => makeKind(Kind.Loss).ledgerDirectionFor()).toThrow();
  });

  test("ROLLBACK sem a referência em mãos lança erro", () => {
    expect(() => makeKind(Kind.Rollback).ledgerDirectionFor()).toThrow();
  });

  // ROLLBACK faz o inverso da referência
  const rollbackCases: [Kind, LedgerDirection][] = [
    [Kind.Bet, LedgerDirection.Credit], // desfazer um débito = crédito
    [Kind.Win, LedgerDirection.Debit], // desfazer um crédito = débito
    [Kind.Refund, LedgerDirection.Debit], // desfazer um crédito = débito
  ];
  test.each(rollbackCases)("ROLLBACK de %s resulta em %s", (refKind, expected) => {
    const reference = makeKind(refKind, { id: "t0", externalTransactionId: "ext-0" });
    const rollback = makeKind(Kind.Rollback);
    expect(rollback.ledgerDirectionFor(reference)).toBe(expected);
  });
});

describe("WagerTransaction.rehydrate", () => {
  test("reconstrói o estado salvo, inclusive terminal", () => {
    const t = WagerTransaction.rehydrate({
      ...baseProps,
      status: Status.Processed,
      referenceTransactionId: "t0",
      processedAt: at,
    });
    expect(t.status).toBe(Status.Processed);
    expect(t.referenceTransactionId).toBe("t0");
    expect(t.processedAt).toEqual(at);
    expect(() => t.fail(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);
  });

  test("não revalida as regras de criação (aceita OPENING, que create recusa)", () => {
    expect(() =>
      WagerTransaction.rehydrate({ ...baseProps, kind: Kind.Opening, status: Status.Processed }),
    ).not.toThrow();
  });
});