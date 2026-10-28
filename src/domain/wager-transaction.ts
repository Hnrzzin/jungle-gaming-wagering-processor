import { InvalidTransactionError, InvalidTransactionStateError } from "./errors";
import { FailureCode } from "./failure-code";
import { Money } from "./money";
import { LedgerDirection } from "./wallet-ledger-entry";

export enum WagerTransactionKind { // estados de transação de aposta
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus { // estados de processamento da transação
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}


export interface CreateWagerTransactionProps { //campos para criar uma transação de aposta
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}


export interface WagerTransactionState extends CreateWagerTransactionProps { // somente os campos necessarios para reidratar uma transação de aposta
  status: WagerTransactionStatus;
  referenceTransactionId?: string; 
  failureCode?: FailureCode;
  processedAt?: Date;
}

function kindRequiresReference(kind: WagerTransactionKind): boolean { //compara se o tipo de transação exige uma referência a outra transação
  return kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus, 
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidTransactionError("OPENING é interno e não pode ser criado por aqui");
    }
    if (kindRequiresReference(props.kind) && !props.referenceExternalTransactionId) {
      throw new InvalidTransactionError(`${props.kind} exige referenceExternalTransactionId`);
    }
    return WagerTransaction.rehydrate({ ...props, status: WagerTransactionStatus.Pending });
  }

  
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }
  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }
  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }
  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  
  
  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  markPendingReference(): void {
    if (this._status !== WagerTransactionStatus.Pending) {
      throw new InvalidTransactionStateError(`Não é possível ir de ${this._status} para PENDING_REFERENCE`);
    }
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
  this.assertNotTerminal();
  this._status = WagerTransactionStatus.Failed;
  this._failureCode = code;
}
    


  isTerminal(): boolean { // retorna o status da transação, é imutavel depois de definido
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return kindRequiresReference(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
  switch (this.kind) {
    case WagerTransactionKind.Bet:
      return LedgerDirection.Debit;

    case WagerTransactionKind.Win:
    case WagerTransactionKind.Refund:
    case WagerTransactionKind.Opening:
      return LedgerDirection.Credit;

    case WagerTransactionKind.Loss:
      throw new InvalidTransactionError("LOSS não movimenta saldo, então não tem direção");

    case WagerTransactionKind.Rollback: {
      if (!reference) {
        throw new InvalidTransactionError("ROLLBACK precisa da transação referenciada");
      }
      
      return reference.ledgerDirectionFor() === LedgerDirection.Debit
        ? LedgerDirection.Credit
        : LedgerDirection.Debit;
    }
  }
}

  private assertNotTerminal(): void { 
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(`Transação em estado terminal (${this._status}) não muda mais`);
    }
  } 
}