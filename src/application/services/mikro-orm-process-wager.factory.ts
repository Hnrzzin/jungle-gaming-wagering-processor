import type {
  ProcessWagerIdGenerator,
  ProcessWagerTransactionManager,
} from "../use-cases/process-wager";
import { DecimalMoneyArithmetic } from "./decimal-money-arithmetic";
import { UuidIdGenerator } from "./uuid-id-generator";
import { ProcessWager } from "../use-cases/process-wager";

export interface ProcessWagerFactoryDependencies {
  readonly transactionManager: ProcessWagerTransactionManager;
  readonly ids?: ProcessWagerIdGenerator;
}

export function createProcessWager(
  dependencies: ProcessWagerFactoryDependencies,
): ProcessWager {
  return new ProcessWager(
    dependencies.transactionManager,
    new DecimalMoneyArithmetic(),
    dependencies.ids ?? new UuidIdGenerator(),
  );
}