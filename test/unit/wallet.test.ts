import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { LedgerDirection } from "../../src/domain/wallet-ledger-entry";
import { CurrencyMismatchError, InsufficientBalanceError } from "../../src/domain/errors";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00Z");
const newWallet = (initial = "100.00") =>
  Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl(initial) });
const op = (money: Money, n = 1) => ({ entryId: `e${n}`, transactionId: `t${n}`, money, at });

describe("Wallet.open", () => {
  test("nasce com o saldo inicial e version 1", () => {
    const w = newWallet("1000.00");
    expect(w.balance.toString()).toBe("1000.00");
    expect(w.version).toBe(1);
  });

  test("rejeita saldo inicial negativo", () => {
    expect(() =>
      Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("10.00").negate() }),
    ).toThrow();
  });
});

describe("Wallet.debit", () => {
  test("debita e devolve o lançamento", () => {
    const w = newWallet();
    const entry = w.debit(op(brl("80.00")));
    expect(w.balance.toString()).toBe("20.00");
    expect(w.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.walletId).toBe("w1");
    expect(entry.transactionId).toBe("t1");
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("20.00");
  });

  test("permite zerar o saldo", () => {
    const w = newWallet();
    w.debit(op(brl("100.00")));
    expect(w.balance.isZero()).toBe(true);
  });

  test("saldo insuficiente lança erro e não altera nada", () => {
    const w = newWallet();
    expect(() => w.debit(op(brl("100.01")))).toThrow(InsufficientBalanceError);
    expect(w.balance.toString()).toBe("100.00");
    expect(w.version).toBe(1);
  });

  test("moeda diferente lança erro", () => {
    const w = newWallet();
    const usd = Money.from({ amount: "10.00", currency: "USD" });
    expect(() => w.debit(op(usd))).toThrow(CurrencyMismatchError);
  });

  test.each(["0.00"])("recusa valor zero: %p", (amount) => {
    expect(() => newWallet().debit(op(brl(amount)))).toThrow();
  });

  test("recusa valor negativo", () => {
    expect(() => newWallet().debit(op(brl("10.00").negate()))).toThrow();
  });
});

describe("Wallet.credit", () => {
  test("credita e devolve o lançamento", () => {
    const w = newWallet("20.00");
    const entry = w.credit(op(brl("30.00")));
    expect(w.balance.toString()).toBe("50.00");
    expect(w.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.toString()).toBe("20.00");
    expect(entry.balanceAfter.toString()).toBe("50.00");
  });
});

describe("Invariante: saldo == saldo reconstruído pelo ledger", () => {
  test("após várias operações", () => {
    const w = newWallet("100.00"); // 100.00 representa o lançamento OPENING
    const entries = [
      w.debit(op(brl("30.00"), 1)),
      w.credit(op(brl("50.00"), 2)),
      w.debit(op(brl("10.00"), 3)),
    ];
    const rebuilt = entries.reduce(
      (acc, e) => (e.direction === LedgerDirection.Credit ? acc.add(e.money) : acc.subtract(e.money)),
      brl("100.00"),
    );
    expect(rebuilt.equals(w.balance)).toBe(true);
  });
});