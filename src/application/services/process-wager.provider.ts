import type { Provider } from "@nestjs/common";
import {
  ID_GENERATOR,
  MONEY_ARITHMETIC,
  PROCESS_WAGER,
  WAGER_TRANSACTION_MANAGER,
} from "../tokens";
import {
  ProcessWager,
  type MoneyArithmetic,
  type ProcessWagerIdGenerator,
  type ProcessWagerTransactionManager,
} from "../use-cases/process-wager";
import { DecimalMoneyArithmetic } from "./decimal-money-arithmetic";
import { UuidIdGenerator } from "./uuid-id-generator";

export const defaultProcessWagerProviders: Provider[] = [
  {
    provide: MONEY_ARITHMETIC,
    useClass: DecimalMoneyArithmetic,
  },
  {
    provide: ID_GENERATOR,
    useClass: UuidIdGenerator,
  },
  {
    provide: PROCESS_WAGER,
    useFactory: (
      transactionManager: ProcessWagerTransactionManager,
      money: MoneyArithmetic,
      ids: ProcessWagerIdGenerator,
    ) => new ProcessWager(transactionManager, money, ids),
    inject: [
      WAGER_TRANSACTION_MANAGER,
      MONEY_ARITHMETIC,
      ID_GENERATOR,
    ],
  },
];