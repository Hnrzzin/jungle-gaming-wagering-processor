import { Decimal } from "decimal.js";
import { CurrencyMismatchError, InvalidMoneyError } from "./errors";

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money { //permite que a classe seja ultilizada em outros arquivos

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money { // recebe as propriedades, chama os métodos de validação e retorna o objeto montado
        Money.assertValidCurrency(props.currency);
        Money.assertValidAmount(props.amount);
        return new Money(new Decimal(props.amount), props.currency);
  }

  static zero(currency: string): Money { // cria um Money de 0.00 em BRL. Serve para inicializar vallores 
        Money.assertValidCurrency(currency);
        return new Money(new Decimal(0), currency);
  }

  add(other: Money): Money { // soma e devolve um Money novo, sem mexer no original
        this.assertSameCurrency(other); // chamo na adição pois não faz sentido somar moedas diferentes
        return new Money(this.value.plus(other.value), this.currency);
  }

  private static assertValidAmount(amount: string): void {
        if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(amount)) {
        throw new InvalidMoneyError(`Valor inválido: "${amount}"`);
    }
  }

  private static assertValidCurrency(currency: string): void {
        if (!/^[A-Z]{3}$/.test(currency)) {
        throw new InvalidMoneyError(`Moeda inválida: "${currency}"`);
    }
  }

  private assertSameCurrency(other: Money): void {
        if (this.currency !== other.currency) {
        throw new CurrencyMismatchError(`${this.currency} é diferente de ${other.currency}`);
    }
  }

   toString(): string {
        return this.value.toFixed(2);
  }

  toJSON(): MoneyProps {
        return { amount: this.toString(), currency: this.currency };
  }

  subtract(other: Money): Money{
        this.assertSameCurrency(other);
        return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money{ //serve para inverter o sinal do valor, útil para operações de subtração
        return new Money(this.value.negated(), this.currency);
  }
  isZero(): boolean{
         return this.value.isZero();
  }
  isPositive(): boolean {
  return this.value.greaterThan(0);
}

    greaterThan(other: Money): boolean {
        this.assertSameCurrency(other);
        return this.value.greaterThan(other.value);
  } 

    isNegative(): boolean{
        return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean{
        this.assertSameCurrency(other);
        if (this.equals(other)) return false;
        return this.value.lessThan(other.value);
        
  }

    equals(other: Money): boolean {
  return this.currency === other.currency && this.value.equals(other.value);
}
  
}

// static: permite chamar um método sem instanciar a classe, pode usar direto pois ele pertence a classe
