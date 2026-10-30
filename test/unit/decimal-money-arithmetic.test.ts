import { describe, expect, it } from "bun:test";
import {
  DecimalMoneyArithmetic,
  MoneyArithmeticError,
} from "../../src/application/services/decimal-money-arithmetic";

describe("DecimalMoneyArithmetic", () => {
  const money = new DecimalMoneyArithmetic();

  it("parses a monetary amount", () => {
    expect(money.parse("100.00", "BRL")).toEqual({
      amount: "100.00",
      currency: "BRL",
    });
  });

  it("accepts zero", () => {
    expect(money.parse("0.00", "BRL")).toEqual({
      amount: "0.00",
      currency: "BRL",
    });
  });

  it("rejects amounts represented as numbers", () => {
    expect(() =>
      money.parse(100 as unknown as string, "BRL"),
    ).toThrow(MoneyArithmeticError);
  });

  it("rejects amounts without two decimal places", () => {
    for (const amount of ["100", "100.0", "100.000", "01.00"]) {
      expect(() => money.parse(amount, "BRL")).toThrow(
        MoneyArithmeticError,
      );
    }
  });

  it("rejects negative amounts", () => {
    expect(() => money.parse("-1.00", "BRL")).toThrow(
      MoneyArithmeticError,
    );
  });

  it("rejects exponent notation", () => {
    expect(() => money.parse("1e2", "BRL")).toThrow(
      MoneyArithmeticError,
    );
  });

  it("rejects invalid currency codes", () => {
    for (const currency of ["brl", "BR", "BRLX", "123"]) {
      expect(() => money.parse("10.00", currency)).toThrow(
        MoneyArithmeticError,
      );
    }
  });

  it("compares equal monetary values", () => {
    expect(
      money.compare(
        money.parse("10.00", "BRL"),
        money.parse("10.00", "BRL"),
      ),
    ).toBe(0);
  });

  it("compares lower monetary values", () => {
    expect(
      money.compare(
        money.parse("9.99", "BRL"),
        money.parse("10.00", "BRL"),
      ),
    ).toBe(-1);
  });

  it("compares higher monetary values", () => {
    expect(
      money.compare(
        money.parse("10.01", "BRL"),
        money.parse("10.00", "BRL"),
      ),
    ).toBe(1);
  });

  it("subtracts decimal monetary values", () => {
    expect(
      money.subtract(
        money.parse("100.00", "BRL"),
        money.parse("80.00", "BRL"),
      ),
    ).toEqual({
      amount: "20.00",
      currency: "BRL",
    });
  });

  it("subtracts fractional monetary values without floating-point arithmetic", () => {
    expect(
      money.subtract(
        money.parse("100.10", "BRL"),
        money.parse("0.20", "BRL"),
      ),
    ).toEqual({
      amount: "99.90",
      currency: "BRL",
    });
  });

  it("allows a result of exactly zero", () => {
    expect(
      money.subtract(
        money.parse("10.00", "BRL"),
        money.parse("10.00", "BRL"),
      ),
    ).toEqual({
      amount: "0.00",
      currency: "BRL",
    });
  });

  it("rejects a negative subtraction result", () => {
    expect(() =>
      money.subtract(
        money.parse("10.00", "BRL"),
        money.parse("10.01", "BRL"),
      ),
    ).toThrow(MoneyArithmeticError);
  });

  it("rejects operations involving different currencies", () => {
    expect(() =>
      money.compare(
        money.parse("10.00", "BRL"),
        money.parse("10.00", "USD"),
      ),
    ).toThrow(MoneyArithmeticError);

    expect(() =>
      money.subtract(
        money.parse("10.00", "BRL"),
        money.parse("1.00", "USD"),
      ),
    ).toThrow(MoneyArithmeticError);
  });

  it("does not mutate input values", () => {
    const balance = money.parse("100.00", "BRL");
    const amount = money.parse("30.00", "BRL");

    money.subtract(balance, amount);

    expect(balance.amount).toBe("100.00");
    expect(amount.amount).toBe("30.00");
  });
});