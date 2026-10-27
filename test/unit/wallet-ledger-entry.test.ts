import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money";
import { LedgerDirection, WalletLedgerEntry } from "../../src/domain/wallet-ledger-entry";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const base = {
  id: "e1",
  walletId: "w1",
  transactionId: "t1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("WalletLedgerEntry.create", () => {
  test("aceita débito balanceado", () => {
    const e = WalletLedgerEntry.create({
      ...base, direction: LedgerDirection.Debit,
      money: brl("80.00"), balanceBefore: brl("100.00"), balanceAfter: brl("20.00"),
    });
    expect(e.isBalanced()).toBe(true);
  });

  test("aceita crédito balanceado", () => {
    const e = WalletLedgerEntry.create({
      ...base, direction: LedgerDirection.Credit,
      money: brl("30.00"), balanceBefore: brl("20.00"), balanceAfter: brl("50.00"),
    });
    expect(e.isBalanced()).toBe(true);
  });

  test("rejeita lançamento que não fecha a conta", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base, direction: LedgerDirection.Debit,
        money: brl("80.00"), balanceBefore: brl("100.00"), balanceAfter: brl("30.00"),
      }),
    ).toThrow();
  });
});