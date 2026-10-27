import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money.ts";

describe("Money.from", () => {
  test("aceita valor com 2 casas", () => {
    expect(Money.from({ amount: "25.00", currency: "BRL" }).toString()).toBe("25.00");
  });

  test("normaliza para 2 casas", () => {
    expect(Money.from({ amount: "25", currency: "BRL" }).toString()).toBe("25.00");
    expect(Money.from({ amount: "25.5", currency: "BRL" }).toString()).toBe("25.50");
  });

  test.each(["25.005", "abc", "", "NaN", "Infinity", "1e2", "-10.00", " 25.00"])(
    "rejeita entrada inválida: %p",
    (amount) => {
      expect(() => Money.from({ amount, currency: "BRL" })).toThrow();
    },
  );

  test("rejeita moeda inválida", () => {
    expect(() => Money.from({ amount: "10.00", currency: "br" })).toThrow();
  });
});

describe("Money operações", () => {
  const a = Money.from({ amount: "80.00", currency: "BRL" });
  const b = Money.from({ amount: "20.00", currency: "BRL" });

  test("soma", () => {
    expect(a.add(b).toString()).toBe("100.00");
  });

  test("subtração pode dar negativo internamente", () => {
    const result = b.subtract(a);
    expect(result.toString()).toBe("-60.00");
    expect(result.isNegative()).toBe(true);
  });

  test("0.10 + 0.20 é exatamente 0.30", () => {
    const x = Money.from({ amount: "0.10", currency: "BRL" });
    const y = Money.from({ amount: "0.20", currency: "BRL" });
    expect(x.add(y).toString()).toBe("0.30");
  });

  test("é imutável", () => {
    a.add(b);
    expect(a.toString()).toBe("80.00");
  });

  test("moedas diferentes lançam erro", () => {
    const usd = Money.from({ amount: "10.00", currency: "USD" });
    expect(() => a.add(usd)).toThrow();
    expect(() => a.subtract(usd)).toThrow();
  });

  test("comparações", () => {
    expect(b.isLessThan(a)).toBe(true);
    expect(a.equals(Money.from({ amount: "80", currency: "BRL" }))).toBe(true);
    expect(Money.zero("BRL").isZero()).toBe(true);
  });

  test("toJSON devolve string decimal, nunca number", () => {
    expect(a.toJSON()).toEqual({ amount: "80.00", currency: "BRL" });
  });

  test("zero negado não é negativo", () => {
    const zero = Money.zero("BRL");
    expect(zero.negate().isNegative()).toBe(false);
});
});