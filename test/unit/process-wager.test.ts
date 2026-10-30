import { describe, expect, it } from "bun:test";
import {
  ProcessWager,
  ProcessWagerCurrencyMismatchError,
  ProcessWagerOwnershipError,
  ProcessWagerValidationError,
  ProcessWagerWalletNotFoundError,
  type CreateLedgerRecordInput,
  type CreateWagerRecordInput,
  type LedgerRecord,
  type MoneyArithmetic,
  type MoneyValue,
  type ProcessWagerCommand,
  type ProcessWagerIdGenerator,
  type ProcessWagerTransactionManager,
  type ProcessWagerUnitOfWork,
  type WalletRecord,
  type WagerIdentity,
  type WagerRecord,
} from "../../src/application/use-cases/process-wager";

class TestMoney implements MoneyArithmetic {
  parse(amount: string, currency: string): MoneyValue {
    if (!/^-?\d+\.\d{2}$/.test(amount)) {
      throw new Error("Invalid amount");
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("Invalid currency");
    }

    return { amount, currency };
  }

  compare(left: MoneyValue, right: MoneyValue): -1 | 0 | 1 {
    this.assertCurrency(left, right);

    const leftCents = BigInt(left.amount.replace(".", ""));
    const rightCents = BigInt(right.amount.replace(".", ""));

    if (leftCents < rightCents) return -1;
    if (leftCents > rightCents) return 1;
    return 0;
  }

  subtract(left: MoneyValue, right: MoneyValue): MoneyValue {
    this.assertCurrency(left, right);

    const result =
      BigInt(left.amount.replace(".", "")) -
      BigInt(right.amount.replace(".", ""));

    if (result < 0n) {
      throw new Error("Negative balance");
    }

    return {
      amount: `${result / 100n}.${String(result % 100n).padStart(2, "0")}`,
      currency: left.currency,
    };
  }

  private assertCurrency(left: MoneyValue, right: MoneyValue): void {
    if (left.currency !== right.currency) {
      throw new Error("Currency mismatch");
    }
  }
}

class TestIdGenerator implements ProcessWagerIdGenerator {
  private current = 0;

  generate(): string {
    this.current += 1;
    return `generated-${this.current}`;
  }
}

class TestUnitOfWork implements ProcessWagerUnitOfWork {
  wallet: WalletRecord | null;
  wagers: WagerRecord[] = [];
  ledger: LedgerRecord[] = [];
  lockCalls = 0;
  updateCalls = 0;
  insertWagerCalls = 0;
  insertLedgerCalls = 0;
  expectedVersion: number | null = null;
  private sequence = 0;

  constructor(wallet: WalletRecord | null) {
    this.wallet = wallet;
  }

  async lockWagerIdentity(_identity: WagerIdentity): Promise<void> {
    this.lockCalls += 1;
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerRecord | null> {
    return (
      this.wagers.find(
        (wager) =>
          wager.providerId === providerId &&
          wager.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerRecord | null> {
    return (
      this.wagers.find(
        (wager) =>
          wager.providerId === providerId &&
          wager.externalTransactionId === externalTransactionId,
      ) ?? null
    );
  }

  async findWalletByIdForUpdate(
    walletId: string,
  ): Promise<WalletRecord | null> {
    if (this.wallet?.id !== walletId) return null;
    return this.wallet;
  }

  async insertWager(
    input: CreateWagerRecordInput,
  ): Promise<WagerRecord> {
    this.insertWagerCalls += 1;
    this.sequence += 1;

    const wager: WagerRecord = {
      ...input,
      id: input.id || `wager-${this.sequence}`,
    };

    this.wagers.push(wager);
    return wager;
  }

  async updateWalletBalance(input: {
    walletId: string;
    balance: MoneyValue;
    expectedVersion: number;
    newVersion: number;
  }): Promise<void> {
    this.updateCalls += 1;
    this.expectedVersion = input.expectedVersion;

    if (!this.wallet || this.wallet.id !== input.walletId) {
      throw new Error("Wallet not found");
    }

    if (this.wallet.version !== input.expectedVersion) {
      throw new Error("Wallet version mismatch");
    }

    this.wallet = {
      ...this.wallet,
      balance: input.balance,
      version: input.newVersion,
    };
  }

  async insertLedger(
    input: CreateLedgerRecordInput,
  ): Promise<LedgerRecord> {
    this.insertLedgerCalls += 1;

    const entry: LedgerRecord = { ...input };
    this.ledger.push(entry);

    return entry;
  }
}

class TestTransactionManager implements ProcessWagerTransactionManager {
  transactionCalls = 0;

  constructor(private readonly unitOfWork: TestUnitOfWork) {}

  async transaction<T>(
    operation: (unitOfWork: ProcessWagerUnitOfWork) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    return operation(this.unitOfWork);
  }
}

const command = (
  overrides: Partial<ProcessWagerCommand> = {},
): ProcessWagerCommand => ({
  providerId: "provider-1",
  playerId: "player-1",
  walletId: "wallet-1",
  externalTransactionId: "external-1",
  idempotencyKey: "idempotency-1",
  amount: "80.00",
  currency: "BRL",
  ...overrides,
});

const wallet = (
  overrides: Partial<WalletRecord> = {},
): WalletRecord => ({
  id: "wallet-1",
  playerId: "player-1",
  currency: "BRL",
  balance: { amount: "100.00", currency: "BRL" },
  version: 1,
  ...overrides,
});

const createSubject = (initialWallet: WalletRecord | null) => {
  const unitOfWork = new TestUnitOfWork(initialWallet);
  const transactions = new TestTransactionManager(unitOfWork);
  const processWager = new ProcessWager(
    transactions,
    new TestMoney(),
    new TestIdGenerator(),
  );

  return {
    processWager,
    unitOfWork,
    transactions,
  };
};

describe("ProcessWager", () => {
  it("processes a bet and updates the wallet balance", async () => {
    const subject = createSubject(wallet());

    const result = await subject.processWager.execute(command());

    expect(result.outcome).toBe("PROCESSED");
    expect(result.replayed).toBe(false);
    expect(result.transaction.status).toBe("PROCESSED");
    expect(subject.unitOfWork.wallet?.balance.amount).toBe("20.00");
    expect(subject.unitOfWork.wallet?.version).toBe(2);
    expect(subject.unitOfWork.wagers).toHaveLength(1);
    expect(subject.unitOfWork.ledger).toHaveLength(1);
    expect(subject.unitOfWork.ledger[0]?.direction).toBe("DEBIT");
    expect(subject.unitOfWork.ledger[0]?.balanceBefore.amount).toBe(
      "100.00",
    );
    expect(subject.unitOfWork.ledger[0]?.balanceAfter.amount).toBe(
      "20.00",
    );
    expect(subject.unitOfWork.updateCalls).toBe(1);
  });

  it("rejects a bet when the wallet has insufficient funds", async () => {
    const subject = createSubject(
      wallet({
        balance: { amount: "50.00", currency: "BRL" },
      }),
    );

    const result = await subject.processWager.execute(command());

    expect(result.outcome).toBe("REJECTED");
    expect(result.transaction.status).toBe("REJECTED");
    expect(result.transaction.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(subject.unitOfWork.wallet?.balance.amount).toBe("50.00");
    expect(subject.unitOfWork.wallet?.version).toBe(1);
    expect(subject.unitOfWork.ledger).toHaveLength(0);
    expect(subject.unitOfWork.updateCalls).toBe(0);
    expect(subject.unitOfWork.wagers).toHaveLength(1);
  });

  it("rejects a wager whose amount is zero", async () => {
    const subject = createSubject(wallet());

    await expect(
      subject.processWager.execute(command({ amount: "0.00" })),
    ).rejects.toBeInstanceOf(ProcessWagerValidationError);

    expect(subject.unitOfWork.wagers).toHaveLength(0);
    expect(subject.unitOfWork.updateCalls).toBe(0);
    expect(subject.unitOfWork.ledger).toHaveLength(0);
  });

  it("rejects a negative wager amount", async () => {
    const subject = createSubject(wallet());

    await expect(
      subject.processWager.execute(command({ amount: "-1.00" })),
    ).rejects.toBeInstanceOf(ProcessWagerValidationError);

    expect(subject.unitOfWork.wagers).toHaveLength(0);
  });

  it("rejects an invalid decimal representation", async () => {
    const subject = createSubject(wallet());

    await expect(
      subject.processWager.execute(command({ amount: "80.001" })),
    ).rejects.toThrow();

    expect(subject.unitOfWork.wagers).toHaveLength(0);
  });

  it("does not process a wager for a missing wallet", async () => {
    const subject = createSubject(null);

    await expect(
      subject.processWager.execute(command()),
    ).rejects.toBeInstanceOf(ProcessWagerWalletNotFoundError);

    expect(subject.unitOfWork.wagers).toHaveLength(0);
    expect(subject.unitOfWork.ledger).toHaveLength(0);
  });

  it("rejects a wallet belonging to another player", async () => {
    const subject = createSubject(
      wallet({ playerId: "another-player" }),
    );

    await expect(
      subject.processWager.execute(command()),
    ).rejects.toBeInstanceOf(ProcessWagerOwnershipError);

    expect(subject.unitOfWork.wagers).toHaveLength(0);
    expect(subject.unitOfWork.updateCalls).toBe(0);
  });

  it("rejects a currency mismatch", async () => {
    const subject = createSubject(wallet());

    await expect(
      subject.processWager.execute(command({ currency: "USD" })),
    ).rejects.toBeInstanceOf(ProcessWagerCurrencyMismatchError);

    expect(subject.unitOfWork.wagers).toHaveLength(0);
    expect(subject.unitOfWork.updateCalls).toBe(0);
  });

  it("replays a request with the same idempotency key and payload", async () => {
    const subject = createSubject(wallet());

    const first = await subject.processWager.execute(command());
    const second = await subject.processWager.execute(command());

    expect(first.outcome).toBe("PROCESSED");
    expect(second.outcome).toBe("DUPLICATE");

    if (second.outcome !== "DUPLICATE") {
      throw new Error("Expected duplicate result");
    }

    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(subject.unitOfWork.wagers).toHaveLength(1);
    expect(subject.unitOfWork.ledger).toHaveLength(1);
    expect(subject.unitOfWork.updateCalls).toBe(1);
  });

  it("returns conflict when an idempotency key is reused with a different payload", async () => {
    const subject = createSubject(wallet());

    await subject.processWager.execute(command());

    const result = await subject.processWager.execute(
      command({ amount: "30.00" }),
    );

    expect(result.outcome).toBe("CONFLICT");
    expect(subject.unitOfWork.wagers).toHaveLength(1);
    expect(subject.unitOfWork.ledger).toHaveLength(1);
    expect(subject.unitOfWork.updateCalls).toBe(1);
  });

  it("returns conflict when an idempotency key is reused with another external ID", async () => {
    const subject = createSubject(wallet());

    await subject.processWager.execute(command());

    const result = await subject.processWager.execute(
      command({ externalTransactionId: "external-2" }),
    );

    expect(result.outcome).toBe("CONFLICT");
    expect(subject.unitOfWork.wagers).toHaveLength(1);
    expect(subject.unitOfWork.updateCalls).toBe(1);
  });

  it("returns conflict when an external ID is reused with another idempotency key", async () => {
    const subject = createSubject(wallet());

    await subject.processWager.execute(command());

    const result = await subject.processWager.execute(
      command({ idempotencyKey: "idempotency-2" }),
    );

    expect(result.outcome).toBe("CONFLICT");
    expect(subject.unitOfWork.wagers).toHaveLength(1);
    expect(subject.unitOfWork.updateCalls).toBe(1);
  });

  it("uses the transaction manager for every request", async () => {
    const subject = createSubject(wallet());

    await subject.processWager.execute(command());

    await subject.processWager.execute(
      command({
        idempotencyKey: "idempotency-2",
        externalTransactionId: "external-2",
      }),
    );

    expect(subject.transactions.transactionCalls).toBe(2);
  });

  it("locks request identity before looking up existing transactions", async () => {
    const subject = createSubject(wallet());

    await subject.processWager.execute(command());

    expect(subject.unitOfWork.lockCalls).toBe(1);
  });

  it("does not create a ledger entry for a rejected wager", async () => {
    const subject = createSubject(
      wallet({ balance: { amount: "10.00", currency: "BRL" } }),
    );

    const result = await subject.processWager.execute(command());

    expect(result.outcome).toBe("REJECTED");
    expect(subject.unitOfWork.insertLedgerCalls).toBe(0);
  });

  it("increments wallet version exactly once for a processed wager", async () => {
    const subject = createSubject(wallet({ version: 7 }));

    await subject.processWager.execute(command());

    expect(subject.unitOfWork.wallet?.version).toBe(8);
    expect(subject.unitOfWork.expectedVersion).toBe(7);
  });

  it("does not increment wallet version for a rejected wager", async () => {
    const subject = createSubject(
      wallet({
        balance: { amount: "10.00", currency: "BRL" },
        version: 7,
      }),
    );

    await subject.processWager.execute(command());

    expect(subject.unitOfWork.wallet?.version).toBe(7);
    expect(subject.unitOfWork.updateCalls).toBe(0);
  });

  it("does not allow empty idempotency keys", async () => {
    const subject = createSubject(wallet());

    await expect(
      subject.processWager.execute(command({ idempotencyKey: " " })),
    ).rejects.toBeInstanceOf(ProcessWagerValidationError);
  });

  it("does not allow empty provider IDs", async () => {
    const subject = createSubject(wallet());

    await expect(
      subject.processWager.execute(command({ providerId: "" })),
    ).rejects.toBeInstanceOf(ProcessWagerValidationError);
  });

  it("does not create duplicate transactions for a rejected replay", async () => {
    const subject = createSubject(
      wallet({ balance: { amount: "10.00", currency: "BRL" } }),
    );

    const first = await subject.processWager.execute(command());
    const second = await subject.processWager.execute(command());

    expect(first.outcome).toBe("REJECTED");
    expect(second.outcome).toBe("DUPLICATE");
    expect(subject.unitOfWork.wagers).toHaveLength(1);
    expect(subject.unitOfWork.ledger).toHaveLength(0);
  });

  it("includes the wager type in the canonical payload hash", async () => {
    const subject = createSubject(wallet());

    const result = await subject.processWager.execute(command());

    expect(result.transaction.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });
});