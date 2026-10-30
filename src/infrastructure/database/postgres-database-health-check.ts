import type { HealthCheck } from "../../presentation/http/health.controller";
import type {
  PostgreSQLTransactionConnection,
} from "./postgres-process-wager";

export class PostgreSQLDatabaseHealthCheck implements HealthCheck {
  readonly name = "postgresql";

  constructor(
    private readonly connectionFactory: () => Promise<PostgreSQLTransactionConnection>,
  ) {}

  async check(): Promise<void> {
    const connection = await this.connectionFactory();

    try {
      const result = await connection.query<{ value: number }>(
        "SELECT 1 AS value",
      );

      if (result.rows[0]?.value !== 1) {
        throw new Error("Unexpected PostgreSQL health-check result");
      }
    } finally {
      connection.release();
    }
  }
}