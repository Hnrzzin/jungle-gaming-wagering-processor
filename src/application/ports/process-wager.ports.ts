import type {
  CreateLedgerRecordInput,
  CreateWagerRecordInput,
  LedgerRecord,
  MoneyValue,
  WagerIdentity,
  WagerRecord,
  WalletRecord,
} from "../use-cases/process-wager";

export interface ProcessWagerUnitOfWorkPort {
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

  insertWager(input: CreateWagerRecordInput): Promise<WagerRecord>;

  updateWalletBalance(input: {
    walletId: string;
    balance: MoneyValue;
    expectedVersion: number;
    newVersion: number;
  }): Promise<void>;

  insertLedger(input: CreateLedgerRecordInput): Promise<LedgerRecord>;
}

export interface ProcessWagerTransactionPort {
  transaction<T>(
    callback: (unitOfWork: ProcessWagerUnitOfWorkPort) => Promise<T>,
  ): Promise<T>;
}