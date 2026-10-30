import {
  createWagerPayloadHash,
  type WagerBusinessPayload,
} from "../services/wager-payload-hash";

export type WagerStatus = "PROCESSED" | "REJECTED";
export type WagerType = "BET";
export type LedgerDirection = "DEBIT";
export type FailureCode = "INSUFFICIENT_FUNDS";

export interface MoneyValue {
  readonly amount: string;
  readonly currency: string;
}

export interface MoneyArithmetic {
  parse(amount: string, currency: string): MoneyValue;
  compare(left: MoneyValue, right: MoneyValue): -1 | 0 | 1;
  subtract(left: MoneyValue, right: MoneyValue): MoneyValue;
}

export interface WagerIdentity {
  readonly providerId: string;
  readonly idempotencyKey: string;
  readonly externalTransactionId: string;
}

export interface WagerRecord extends WagerIdentity {
  readonly id: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId?: string;
  readonly gameId?: string;
  readonly payloadHash: string;
  readonly type: WagerType;
  readonly status: WagerStatus;
  readonly amount: MoneyValue;
  readonly failureCode: FailureCode | null;
}

export interface WalletRecord {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: MoneyValue;
  readonly version: number;
}

export interface LedgerRecord {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly amount: MoneyValue;
  readonly balanceBefore: MoneyValue;
  readonly balanceAfter: MoneyValue;
}

export interface CreateWagerRecordInput extends WagerIdentity {
  readonly id: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId?: string;
  readonly gameId?: string;
  readonly payloadHash: string;
  readonly type: WagerType;
  readonly status: WagerStatus;
  readonly amount: MoneyValue;
  readonly failureCode: FailureCode | null;
}

export interface CreateLedgerRecordInput {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly amount: MoneyValue;
  readonly balanceBefore: MoneyValue;
  readonly balanceAfter: MoneyValue;
}

export interface ProcessWagerUnitOfWork {
  lockWagerIdentity(identity: WagerIdentity): Promise<void>;

  findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerRecord | null>;

  findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerRecord | null>;

  findWalletByIdForUpdate(walletId: string): Promise<WalletRecord | null>;

  insertWager(record: CreateWagerRecordInput): Promise<WagerRecord>;

  updateWalletBalance(input: {
    walletId: string;
    balance: MoneyValue;
    expectedVersion: number;
    newVersion: number;
  }): Promise<void>;

  insertLedger(record: CreateLedgerRecordInput): Promise<LedgerRecord>;
}

export interface ProcessWagerTransactionManager {
  transaction<T>(
    operation: (unitOfWork: ProcessWagerUnitOfWork) => Promise<T>,
  ): Promise<T>;
}

export interface ProcessWagerIdGenerator {
  generate(): string;
}

export interface ProcessWagerCommand {
  readonly providerId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly amount: string;
  readonly currency: string;
  readonly roundId?: string;
  readonly gameId?: string;
}

export type ProcessWagerResult =
  | {
      readonly outcome: "PROCESSED";
      readonly transaction: WagerRecord;
      readonly replayed: false;
    }
  | {
      readonly outcome: "REJECTED";
      readonly transaction: WagerRecord;
      readonly replayed: false;
    }
  | {
      readonly outcome: "DUPLICATE";
      readonly transaction: WagerRecord;
      readonly replayed: true;
    }
  | {
      readonly outcome: "CONFLICT";
      readonly transaction: WagerRecord;
      readonly replayed: false;
    };

export class ProcessWagerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessWagerValidationError";
  }
}

export class ProcessWagerWalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`Wallet not found: ${walletId}`);
    this.name = "ProcessWagerWalletNotFoundError";
  }
}

export class ProcessWagerOwnershipError extends Error {
  constructor() {
    super("Wallet does not belong to the requested player");
    this.name = "ProcessWagerOwnershipError";
  }
}

export class ProcessWagerCurrencyMismatchError extends Error {
  constructor() {
    super("Wallet currency does not match wager currency");
    this.name = "ProcessWagerCurrencyMismatchError";
  }
}

type Classification =
  | { readonly outcome: "NEW" }
  | {
      readonly outcome: "DUPLICATE";
      readonly transaction: WagerRecord;
    }
  | {
      readonly outcome: "CONFLICT";
      readonly transaction: WagerRecord;
    };

export class ProcessWager {
  constructor(
    private readonly transactions: ProcessWagerTransactionManager,
    private readonly money: MoneyArithmetic,
    private readonly ids: ProcessWagerIdGenerator,
  ) {}

  async execute(command: ProcessWagerCommand): Promise<ProcessWagerResult> {
    this.validateCommand(command);

    const amount = this.money.parse(command.amount, command.currency);
    const zero = this.money.parse("0.00", command.currency);

    if (this.money.compare(amount, zero) <= 0) {
      throw new ProcessWagerValidationError(
        "Wager amount must be greater than zero",
      );
    }

    const identity: WagerIdentity = {
      providerId: command.providerId,
      idempotencyKey: command.idempotencyKey,
      externalTransactionId: command.externalTransactionId,
    };

    const payload: WagerBusinessPayload = {
      providerId: command.providerId,
      playerId: command.playerId,
      walletId: command.walletId,
      externalTransactionId: command.externalTransactionId,
      type: "BET",
      amount: amount.amount,
      currency: amount.currency,
      ...(command.roundId === undefined ? {} : { roundId: command.roundId }),
      ...(command.gameId === undefined ? {} : { gameId: command.gameId }),
    };

    const payloadHash = createWagerPayloadHash(payload);

    return this.transactions.transaction(async (unitOfWork) => {
      await unitOfWork.lockWagerIdentity(identity);

      const classification = await this.classify(
        unitOfWork,
        command,
        payloadHash,
      );

      if (classification.outcome === "DUPLICATE") {
        return {
          outcome: "DUPLICATE",
          transaction: classification.transaction,
          replayed: true,
        };
      }

      if (classification.outcome === "CONFLICT") {
        return {
          outcome: "CONFLICT",
          transaction: classification.transaction,
          replayed: false,
        };
      }

      const wallet = await unitOfWork.findWalletByIdForUpdate(
        command.walletId,
      );

      if (!wallet) {
        throw new ProcessWagerWalletNotFoundError(command.walletId);
      }

      if (wallet.playerId !== command.playerId) {
        throw new ProcessWagerOwnershipError();
      }

      if (wallet.currency !== command.currency) {
        throw new ProcessWagerCurrencyMismatchError();
      }

      if (wallet.balance.currency !== command.currency) {
        throw new ProcessWagerCurrencyMismatchError();
      }

      if (this.money.compare(wallet.balance, amount) < 0) {
        const rejected = await unitOfWork.insertWager({
          id: this.ids.generate(),
          ...identity,
          playerId: command.playerId,
          walletId: command.walletId,
          ...(command.roundId === undefined ? {} : { roundId: command.roundId }),
          ...(command.gameId === undefined ? {} : { gameId: command.gameId }),
          payloadHash,
          type: "BET",
          status: "REJECTED",
          amount,
          failureCode: "INSUFFICIENT_FUNDS",
        });

        return {
          outcome: "REJECTED",
          transaction: rejected,
          replayed: false,
        };
      }

      const newBalance = this.money.subtract(wallet.balance, amount);
      const newVersion = wallet.version + 1;

      const processed = await unitOfWork.insertWager({
        id: this.ids.generate(),
        ...identity,
        playerId: command.playerId,
        walletId: command.walletId,
        ...(command.roundId === undefined ? {} : { roundId: command.roundId }),
        ...(command.gameId === undefined ? {} : { gameId: command.gameId }),
        payloadHash,
        type: "BET",
        status: "PROCESSED",
        amount,
        failureCode: null,
      });

      await unitOfWork.updateWalletBalance({
        walletId: wallet.id,
        balance: newBalance,
        expectedVersion: wallet.version,
        newVersion,
      });

      await unitOfWork.insertLedger({
        id: this.ids.generate(),
        walletId: wallet.id,
        transactionId: processed.id,
        direction: "DEBIT",
        amount,
        balanceBefore: wallet.balance,
        balanceAfter: newBalance,
      });

      return {
        outcome: "PROCESSED",
        transaction: processed,
        replayed: false,
      };
    });
  }

  private async classify(
    unitOfWork: ProcessWagerUnitOfWork,
    command: ProcessWagerCommand,
    payloadHash: string,
  ): Promise<Classification> {
    const byIdempotencyKey = await unitOfWork.findByIdempotencyKey(
      command.providerId,
      command.idempotencyKey,
    );

    const byExternalTransactionId =
      await unitOfWork.findByExternalTransactionId(
        command.providerId,
        command.externalTransactionId,
      );

    if (!byIdempotencyKey && !byExternalTransactionId) {
      return { outcome: "NEW" };
    }

    if (
      byIdempotencyKey &&
      byExternalTransactionId &&
      byIdempotencyKey.id !== byExternalTransactionId.id
    ) {
      return {
        outcome: "CONFLICT",
        transaction: byIdempotencyKey,
      };
    }

    const existing = byIdempotencyKey ?? byExternalTransactionId;

    if (!existing) {
      return { outcome: "NEW" };
    }

    const matches =
      existing.providerId === command.providerId &&
      existing.idempotencyKey === command.idempotencyKey &&
      existing.externalTransactionId === command.externalTransactionId &&
      existing.payloadHash === payloadHash &&
      existing.playerId === command.playerId &&
      existing.walletId === command.walletId &&
      existing.type === "BET";

    if (matches) {
      return {
        outcome: "DUPLICATE",
        transaction: existing,
      };
    }

    return {
      outcome: "CONFLICT",
      transaction: existing,
    };
  }

  private validateCommand(command: ProcessWagerCommand): void {
    const required: Array<[string, string]> = [
      ["providerId", command.providerId],
      ["playerId", command.playerId],
      ["walletId", command.walletId],
      ["externalTransactionId", command.externalTransactionId],
      ["idempotencyKey", command.idempotencyKey],
      ["amount", command.amount],
      ["currency", command.currency],
    ];

    for (const [field, value] of required) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new ProcessWagerValidationError(`${field} is required`);
      }
    }
  }
}