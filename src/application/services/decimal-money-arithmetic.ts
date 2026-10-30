import Decimal from "decimal.js";
import type {
  MoneyArithmetic,
  MoneyValue,
} from "../use-cases/process-wager";

const DecimalValue = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export class MoneyArithmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyArithmeticError";
  }
}

export class DecimalMoneyArithmetic implements MoneyArithmetic {
  parse(amount: string, currency: string): MoneyValue {
    if (typeof amount !== "string") {
      throw new MoneyArithmeticError("Amount must be a string");
    }

    if (!/^(0|[1-9]\d*)\.\d{2}$/.test(amount)) {
      throw new MoneyArithmeticError(
        "Amount must have exactly two decimal places",
      );
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new MoneyArithmeticError(
        "Currency must be an uppercase ISO 4217 code",
      );
    }

    let decimal: Decimal;

    try {
      decimal = new DecimalValue(amount);
    } catch {
      throw new MoneyArithmeticError("Invalid monetary amount");
    }

    if (!decimal.isFinite() || decimal.isNegative()) {
      throw new MoneyArithmeticError(
        "Amount must be a finite non-negative value",
      );
    }

    return {
      amount: decimal.toFixed(2),
      currency,
    };
  }

  compare(left: MoneyValue, right: MoneyValue): -1 | 0 | 1 {
    this.assertSameCurrency(left, right);

    const comparison = new DecimalValue(left.amount).comparedTo(
      new DecimalValue(right.amount),
    );

    if (comparison === null) {
      throw new MoneyArithmeticError("Cannot compare invalid amounts");
    }

    if (comparison < 0) return -1;
    if (comparison > 0) return 1;
    return 0;
  }

  subtract(left: MoneyValue, right: MoneyValue): MoneyValue {
    this.assertSameCurrency(left, right);

    const result = new DecimalValue(left.amount).minus(
      new DecimalValue(right.amount),
    );

    if (result.isNegative()) {
      throw new MoneyArithmeticError("Balance cannot become negative");
    }

    return {
      amount: result.toFixed(2),
      currency: left.currency,
    };
  }

  private assertSameCurrency(
    left: MoneyValue,
    right: MoneyValue,
  ): void {
    if (left.currency !== right.currency) {
      throw new MoneyArithmeticError("Currency mismatch");
    }

    if (!/^[A-Z]{3}$/.test(left.currency)) {
      throw new MoneyArithmeticError("Invalid currency");
    }

    if (
      !/^(0|[1-9]\d*)\.\d{2}$/.test(left.amount) ||
      !/^(0|[1-9]\d*)\.\d{2}$/.test(right.amount)
    ) {
      throw new MoneyArithmeticError("Invalid monetary representation");
    }
  }
}