import {
  CurrencyMismatchError,
  InsufficientBalanceError,
  InvalidOperationAmountError,
  InvalidWalletError,
} from "./errors";
import { Money } from "./money";
import { LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";


export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}


export interface WalletOperation {
  entryId: string;
  transactionId: string;
  money: Money;
  at: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidWalletError("Saldo inicial não pode ser negativo");
    }
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(op: WalletOperation): WalletLedgerEntry {
    this.assertValidOperation(op.money);

    if (this._balance.isLessThan(op.money)) {
      throw new InsufficientBalanceError("Saldo insuficiente");
    }

    const before = this._balance;
    const after = before.subtract(op.money);

    
    const entry = WalletLedgerEntry.create({
      id: op.entryId,
      walletId: this.id,
      transactionId: op.transactionId,
      createdAt: op.at,
      direction: LedgerDirection.Debit,
      money: op.money,
      balanceBefore: before,
      balanceAfter: after,
    });

   
    this._balance = after;
    this._version += 1;
    this._updatedAt = op.at;

    return entry;
  }

  credit(op: WalletOperation): WalletLedgerEntry {
    
    if (this.currency !== op.money.currency) {
      throw new CurrencyMismatchError(`${this.currency} é diferente de ${op.money.currency}`);
    }

    const before = this._balance;
    const after = before.add(op.money);

    const entry = WalletLedgerEntry.create({
        id: op.entryId,
        walletId: this.id,
        transactionId: op.transactionId,
        createdAt: op.at,
        direction: LedgerDirection.Credit,
        money: op.money,
        balanceBefore: before,
        balanceAfter: after,
    });

    this._balance = after;
    this._version += 1;
    this._updatedAt = op.at;

    return entry;
  }

  private assertValidOperation(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(`${this.currency} é diferente de ${money.currency}`);
    }
    if (!money.isPositive()) {
      throw new InvalidOperationAmountError("O valor da operação deve ser maior que zero");
    }
  }
}