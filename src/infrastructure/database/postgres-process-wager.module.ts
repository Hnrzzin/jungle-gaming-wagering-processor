import { Module, type Provider } from "@nestjs/common";
import {
  WAGER_TRANSACTION_MANAGER,
} from "../../application/tokens";
import type {
  MikroOrmEntityManagerLike,
} from "./mikro-orm-transaction-provider";
import {
  MikroOrmPostgreSQLTransactionProvider,
} from "./mikro-orm-transaction-provider";
import {
  PostgreSQLProcessWagerTransactionManager,
} from "./postgres-process-wager";
import {
  POSTGRES_PROCESS_WAGER_SCHEMA,
} from "./postgres-process-wager.schema";

export const MIKRO_ORM_ENTITY_MANAGER = Symbol(
  "MIKRO_ORM_ENTITY_MANAGER",
);

export function createPostgreSQLProcessWagerProvider(): Provider {
  return {
    provide: WAGER_TRANSACTION_MANAGER,
    inject: [MIKRO_ORM_ENTITY_MANAGER],
    useFactory: (entityManager: MikroOrmEntityManagerLike) => {
      const transactionProvider =
        new MikroOrmPostgreSQLTransactionProvider(entityManager);

      return new PostgreSQLProcessWagerTransactionManager(
        transactionProvider,
        POSTGRES_PROCESS_WAGER_SCHEMA,
      );
    },
  };
}

@Module({})
export class PostgreSQLProcessWagerModule {
  static register(
    entityManagerProvider: Provider,
  ) {
    return {
      module: PostgreSQLProcessWagerModule,
      providers: [
        entityManagerProvider,
        createPostgreSQLProcessWagerProvider(),
      ],
      exports: [WAGER_TRANSACTION_MANAGER],
    };
  }
}