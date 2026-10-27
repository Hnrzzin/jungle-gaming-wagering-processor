import { InvalidLedgerEntryError } from "./errors";
import { Money } from "./money";


export enum LedgerDirection {
    Debit = "DEBIT",
    Credit = "CREDIT",
}


export interface WalletLedgerEntryProps {
    
  id: string;
  walletId: string;
  transactionId: string;
  createdAt: Date;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export class WalletLedgerEntry {

    
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly createdAt: Date,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
  ) {}

    static create(props: WalletLedgerEntryProps): WalletLedgerEntry {
       if (!props.money.isPositive() || props.money.isZero()) {
        throw new InvalidLedgerEntryError("O valor do lançamento deve ser positivo e maior que zero");
       }
       const entry = WalletLedgerEntry.rehydrate(props);
       if (!entry.isBalanced()) {
        throw new InvalidLedgerEntryError("O lançamento não fecha a conta");
       }
        return entry;
    }

    static rehydrate(props: WalletLedgerEntryProps): WalletLedgerEntry {
    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.createdAt,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
    );
  }

    isBalanced(): boolean {
        return this.expectedBalanceAfter().equals(this.balanceAfter);
    }

    private expectedBalanceAfter(): Money {
        if (this.direction === LedgerDirection.Debit) {
            return this.balanceBefore.subtract(this.money);
        } else {
            return this.balanceBefore.add(this.money);
        }
    }
   
}