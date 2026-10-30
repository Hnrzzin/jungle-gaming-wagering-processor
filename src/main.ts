import "reflect-metadata";

import {
  type DynamicModule,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { MikroORM } from "@mikro-orm/postgresql";
import {
  WAGER_TRANSACTION_MANAGER,
  CREATE_WALLET,
} from "./application/tokens";
import { createOrm } from "./infrastructure/database/orm";
import { CreateWallet } from "./application/use-cases/create-wallet";
import {
  MikroOrmPostgreSQLTransactionProvider,
  type MikroOrmEntityManagerLike,
} from "./infrastructure/database/mikro-orm-transaction-provider";
import {
  PostgreSQLProcessWagerTransactionManager,
} from "./infrastructure/database/postgres-process-wager";
import {
  POSTGRES_PROCESS_WAGER_SCHEMA,
} from "./infrastructure/database/postgres-process-wager.schema";
import { WagerHttpModule } from "./presentation/http/wager-http.module";
import { PostgreSQLSchemaValidator } from "./infrastructure/database/postgres-schema-validator";
import { PostgreSQLIndexValidator } from "./infrastructure/database/postgres-index-validator";

class OrmLifecycle implements OnApplicationShutdown {
  constructor(private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    await this.orm.close();
  }
}

@Module({})
class AppModule {
  static register(orm: MikroORM): DynamicModule {
    const entityManager = orm.em as unknown as MikroOrmEntityManagerLike;

    return {
      module: AppModule,
      imports: [
        WagerHttpModule.register({
          healthChecks: [
            {
              name: "postgres",
              check: async () => {
                await orm.em.getConnection().execute("SELECT 1");
              },
            },
            {
              name: "postgres-schema",
              check: async () => {
                const transactionProvider =
                  new MikroOrmPostgreSQLTransactionProvider(entityManager);

                await transactionProvider.transaction(async (connection) => {
                  await new PostgreSQLSchemaValidator(connection, [
                    {
                      table: "wallets",
                      columns: [
                        "id",
                        "player_id",
                        "currency",
                        "balance",
                        "version",
                      ],
                    },
                    {
                      table: "wagering_transactions",
                      columns: [
                        "id",
                        "provider_id",
                        "player_id",
                        "wallet_id",
                        "external_transaction_id",
                        "idempotency_key",
                        "payload_hash",
                        "round_id",
                        "game_id",
                        "kind",
                        "status",
                        "amount",
                        "currency",
                        "failure_code",
                        "created_at",
                      ],
                    },
                    {
                      table: "wallet_ledger_entries",
                      columns: [
                        "id",
                        "wallet_id",
                        "transaction_id",
                        "direction",
                        "amount",
                        "currency",
                        "balance_before",
                        "balance_after",
                        "created_at",
                      ],
                    },
                  ]).validate();

                  await new PostgreSQLIndexValidator(connection).validate();
                });
              },
            },
          ],
          extraProviders: [
            {
              provide: WAGER_TRANSACTION_MANAGER,
              useFactory: () =>
                new PostgreSQLProcessWagerTransactionManager(
                  new MikroOrmPostgreSQLTransactionProvider(entityManager),
                  POSTGRES_PROCESS_WAGER_SCHEMA,
                ),
            },
            {
              provide: CREATE_WALLET,
              useFactory: () => new CreateWallet(orm.em),
            },
          ],
        }),
      ],
      providers: [
        {
          provide: OrmLifecycle,
          useFactory: () => new OrmLifecycle(orm),
        },
      ],
    };
  }
}

async function bootstrap(): Promise<void> {
  const orm = await createOrm();

  try {
    const app = await NestFactory.create(AppModule.register(orm), {
      bufferLogs: true,
    });

    app.enableShutdownHooks();
    app.setGlobalPrefix("api");
    app.enableCors();

    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.HOST ?? "0.0.0.0";

    await app.listen(port, host);
    console.info(`Wagering Processor listening on http://${host}:${port}/api`);
  } catch (error) {
    await orm.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start Wagering Processor", error);
  process.exitCode = 1;
});
