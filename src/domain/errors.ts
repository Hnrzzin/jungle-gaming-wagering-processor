export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidMoneyError extends DomainError {}
export class CurrencyMismatchError extends DomainError {}
export class InsufficientBalanceError extends DomainError {}
export class InvalidOperationAmountError extends DomainError {}
export class InvalidLedgerEntryError extends DomainError {}
export class InvalidWalletError extends DomainError {}
export class InvalidTransactionError extends DomainError {}
export class InvalidTransactionStateError extends DomainError {}
